"""Bound request bodies before multipart parsing and return scrubbed errors."""

import uuid

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def error_response(code: str, message: str, status: int, request_id: str) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message}, "request_id": request_id},
        status_code=status,
        headers={"Cache-Control": "no-store", "X-Request-ID": request_id},
    )


class RequestGuardMiddleware:
    """Bound even chunked bodies; avoid content-bearing access logs or error details.

    A maximum of max_bytes is buffered in memory per request. Size is checked before
    multipart parsing, including uploads and overhead. A deployment must also limit
    concurrent requests and slow clients at its proxy; this is a local development API.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = f"req_{uuid.uuid4().hex}"
        scope.setdefault("state", {})["request_id"] = request_id

        async def reject(code: str, message: str, status: int) -> None:
            response = error_response(code, message, status, request_id)
            await response(scope, receive, send)

        lengths = [value for key, value in scope.get("headers", []) if key == b"content-length"]
        if len(lengths) > 1:
            await reject("invalid_request", "Ambiguous Content-Length headers.", 400)
            return
        if lengths:
            try:
                declared = int(lengths[0])
                if declared < 0:
                    raise ValueError
            except ValueError:
                await reject("invalid_request", "Invalid Content-Length header.", 400)
                return
            if declared > self.max_bytes:
                await reject("too_large", "Request exceeds the configured byte limit.", 413)
                return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > self.max_bytes:
                await reject("too_large", "Request exceeds the configured byte limit.", 413)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        async def response_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [
                    pair
                    for pair in message.get("headers", [])
                    if pair[0].lower() not in {b"cache-control", b"x-request-id"}
                ]
                message["headers"].extend(
                    [(b"x-request-id", request_id.encode()), (b"cache-control", b"no-store")]
                )
            await send(message)

        await self.app(scope, replay, response_headers)
