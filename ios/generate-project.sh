#!/bin/sh
set -eu

cd "$(dirname "$0")"

if ! xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1; then
    printf '%s\n' 'Full Xcode with the iOS SDK is required. Install Xcode, finish its first launch, then use DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer for this command.' >&2
    exit 1
fi
if ! command -v xcodegen >/dev/null 2>&1; then
    printf '%s\n' 'XcodeGen 2.42 or newer is required. See ios/README.md for setup.' >&2
    exit 1
fi

if [ ! -f Configuration/Developer.xcconfig ]; then
    cp Configuration/Developer.xcconfig.example Configuration/Developer.xcconfig
fi

xcodegen generate --spec project.json
xcodebuild -list -project Ravel.xcodeproj
