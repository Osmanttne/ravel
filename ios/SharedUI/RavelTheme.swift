import SwiftUI

struct RavelPalette {
    let canvas: Color
    let canvasSecondary: Color
    let surface: Color
    let raisedSurface: Color
    let border: Color
    let primaryText: Color
    let secondaryText: Color
    let accent: Color
    let accentSoft: Color
    let brandBlue: Color
    let brandTeal: Color
    let brandGreen: Color
    let brandViolet: Color
    let caution: Color
    let danger: Color
    let review: Color
    let information: Color

    init(_ scheme: ColorScheme) {
        if scheme == .dark {
            canvas = Color(red: 0.035, green: 0.055, blue: 0.082)
            canvasSecondary = Color(red: 0.055, green: 0.090, blue: 0.125)
            surface = Color(red: 0.075, green: 0.105, blue: 0.145)
            raisedSurface = Color(red: 0.095, green: 0.135, blue: 0.175)
            border = Color.white.opacity(0.085)
            primaryText = Color(red: 0.93, green: 0.96, blue: 0.97)
            secondaryText = Color(red: 0.62, green: 0.70, blue: 0.76)
            accent = Color(red: 0.38, green: 0.53, blue: 1.00)
            accentSoft = Color(red: 0.12, green: 0.18, blue: 0.35)
            brandBlue = Color(red: 0.10, green: 0.36, blue: 0.98)
            brandTeal = Color(red: 0.02, green: 0.72, blue: 0.77)
            brandGreen = Color(red: 0.28, green: 0.76, blue: 0.34)
            brandViolet = Color(red: 0.32, green: 0.24, blue: 0.88)
            caution = Color(red: 1.00, green: 0.76, blue: 0.43)
            danger = Color(red: 1.00, green: 0.49, blue: 0.53)
            review = Color(red: 0.75, green: 0.66, blue: 1.00)
            information = brandTeal
        } else {
            canvas = Color(red: 0.95, green: 0.97, blue: 0.97)
            canvasSecondary = Color(red: 0.90, green: 0.96, blue: 0.94)
            surface = Color.white
            raisedSurface = Color(red: 0.97, green: 0.99, blue: 0.98)
            border = Color(red: 0.12, green: 0.22, blue: 0.24).opacity(0.10)
            primaryText = Color(red: 0.08, green: 0.14, blue: 0.18)
            secondaryText = Color(red: 0.34, green: 0.42, blue: 0.46)
            accent = Color(red: 0.12, green: 0.31, blue: 0.88)
            accentSoft = Color(red: 0.89, green: 0.92, blue: 1.00)
            brandBlue = Color(red: 0.08, green: 0.33, blue: 0.96)
            brandTeal = Color(red: 0.00, green: 0.58, blue: 0.66)
            brandGreen = Color(red: 0.16, green: 0.63, blue: 0.27)
            brandViolet = Color(red: 0.31, green: 0.22, blue: 0.78)
            caution = Color(red: 0.61, green: 0.34, blue: 0.05)
            danger = Color(red: 0.69, green: 0.18, blue: 0.24)
            review = Color(red: 0.39, green: 0.27, blue: 0.68)
            information = brandTeal
        }
    }
}

struct RavelBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let palette = RavelPalette(colorScheme)

        ZStack(alignment: .topTrailing) {
            LinearGradient(
                colors: [palette.canvas, palette.canvasSecondary],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(palette.brandTeal.opacity(colorScheme == .dark ? 0.10 : 0.08))
                .frame(width: 260, height: 260)
                .blur(radius: 85)
                .offset(x: 115, y: -125)
            Circle()
                .fill(palette.brandViolet.opacity(colorScheme == .dark ? 0.07 : 0.05))
                .frame(width: 230, height: 230)
                .blur(radius: 90)
                .offset(x: -230, y: 180)
        }
        .ignoresSafeArea()
    }
}

struct RavelSignalField: View {
    let palette: RavelPalette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var spectrum: [Color] {
        [palette.brandGreen, palette.brandTeal, palette.brandBlue, palette.brandViolet]
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20.0, paused: reduceMotion)) { timeline in
            let colors = spectrum
            let phaseOffset = reduceMotion
                ? 0
                : CGFloat(timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 8) / 8) * .pi * 2

            Canvas { context, size in
                for band in 0..<4 {
                    var path = Path()
                    for step in 0...56 {
                        let progress = CGFloat(step) / 56
                        let envelope = sin(progress * .pi)
                        let phase = progress * .pi * 2.2 + CGFloat(band) * 0.68 + phaseOffset
                        let y = size.height * 0.48
                            + sin(phase) * size.height * 0.25 * envelope
                            + (CGFloat(band) - 1.5) * 8
                        let point = CGPoint(x: size.width * progress, y: y)
                        if step == 0 {
                            path.move(to: point)
                        } else {
                            path.addLine(to: point)
                        }
                    }
                    context.stroke(
                        path,
                        with: .linearGradient(
                            Gradient(colors: [colors[band], colors[(band + 2) % colors.count]]),
                            startPoint: CGPoint(x: 0, y: size.height * CGFloat(band) / 4),
                            endPoint: CGPoint(x: size.width, y: size.height * CGFloat(4 - band) / 4)
                        ),
                        style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round)
                    )
                }

                for column in 0..<25 {
                    let progress = CGFloat(column) / 24
                    let envelope = sin(progress * .pi)
                    for row in 0..<5 {
                        let phase = progress * .pi * 2.2 + CGFloat(row) * 0.44 + phaseOffset
                        let y = size.height * 0.48
                            + sin(phase) * size.height * 0.25 * envelope
                            + (CGFloat(row) - 2) * 13
                        let radius = 1.1 + envelope * (0.7 + CGFloat(row % 3) * 0.25)
                        let dot = CGRect(x: size.width * progress - radius,
                                         y: y - radius,
                                         width: radius * 2,
                                         height: radius * 2)
                        context.fill(Path(ellipseIn: dot), with: .color(colors[column % colors.count].opacity(0.18 + envelope * 0.42)))
                    }
                }
            }
            .accessibilityHidden(true)
        }
    }
}

struct RavelBrandMark: View {
    let palette: RavelPalette

    var body: some View {
        Text("RAVEL")
            .font(.system(size: 17, weight: .bold, design: .rounded))
            .tracking(2.8)
            .foregroundStyle(palette.primaryText)
            .accessibilityLabel("Ravel")
    }
}

struct RavelEyebrow: View {
    let title: String
    let palette: RavelPalette

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .tracking(1.25)
            .foregroundStyle(palette.secondaryText)
    }
}

struct RavelSurface<Content: View>: View {
    let palette: RavelPalette
    let content: Content

    init(palette: RavelPalette, @ViewBuilder content: () -> Content) {
        self.palette = palette
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: 23, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 23, style: .continuous)
                    .stroke(palette.border, lineWidth: 1)
            }
    }
}
