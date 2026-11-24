// Minimal tvOS app the tvOS driver's integration tests run against. Plain SwiftUI, no toets
// SDK: it proves the driver works black-box on any native app. Every element tests touch has
// an accessibility identifier (toets's testId on tvOS).

import SwiftUI
import os

private let log = Logger(subsystem: "tv.toets.fixture", category: "app")

/// The part of toets's launch payload this fixture reads. toets passes it as the launch
/// arguments `-__toets <base64url(JSON)>`, which UserDefaults exposes under the key `__toets`.
struct LaunchPayload: Decodable {
  let v: Int
  let state: String?
}

func readLaunchPayload() -> LaunchPayload? {
  guard let raw = UserDefaults.standard.string(forKey: "__toets"),
    let data = decodePayload(raw)
  else { return nil }
  return try? JSONDecoder().decode(LaunchPayload.self, from: data)
}

/// base64url (unpadded) JSON; plain JSON is accepted too.
func decodePayload(_ raw: String) -> Data? {
  if raw.hasPrefix("{") { return raw.data(using: .utf8) }
  var base64 = raw.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
  return Data(base64Encoded: base64)
}

enum Route: Hashable {
  case details(Int)
  case player(Int)
}

@main
struct ToetsFixtureApp: App {
  var body: some Scene {
    WindowGroup { RootView() }
  }
}

struct RootView: View {
  @State private var path: [Route] = []
  private let payload = readLaunchPayload()

  var body: some View {
    NavigationStack(path: $path) {
      HomeView(payloadState: payload?.state ?? "none")
        .navigationDestination(for: Route.self) { route in
          switch route {
          case .details(let item): DetailsView(item: item)
          case .player(let item): PlayerView(item: item)
          }
        }
    }
    .onAppear {
      log.notice("toets-fixture: launched state=\(payload?.state ?? "none", privacy: .public)")
      // App-defined launch state, the way an app would apply the payload's `state`.
      if payload?.state == "details" { path = [.details(1)] }
    }
  }
}

struct HomeView: View {
  let payloadState: String

  var body: some View {
    VStack(alignment: .leading, spacing: 40) {
      Text("toets fixture")
        .font(.largeTitle)
        .accessibilityIdentifier("title")
      Text("payload: \(payloadState)")
        .accessibilityIdentifier("payload_state")
      ScrollView(.horizontal) {
        HStack(spacing: 40) {
          ForEach(1...8, id: \.self) { item in
            NavigationLink(value: Route.details(item)) {
              Text("Item \(item)").frame(width: 300, height: 170)
            }
            .accessibilityIdentifier("rail_item_\(item)")
          }
        }
        .padding(40)
      }
      // `.contain` keeps the rail's identifier from propagating to its children.
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("rail")
      HStack(spacing: 40) {
        Button("Settings") { log.notice("toets-fixture: settings") }
          .accessibilityIdentifier("settings_button")
        Button("Disabled") {}
          .disabled(true)
          .accessibilityIdentifier("disabled_button")
      }
    }
    .padding(80)
  }
}

struct DetailsView: View {
  let item: Int
  @State private var liked = false

  var body: some View {
    VStack(spacing: 40) {
      Text("Details Item \(item)")
        .font(.title)
        .accessibilityIdentifier("details_title")
      Text(liked ? "Liked" : "Not liked")
        .accessibilityIdentifier("like_state")
      HStack(spacing: 40) {
        NavigationLink(value: Route.player(item)) { Text("Play") }
          .accessibilityIdentifier("play_button")
        Button(liked ? "Unlike" : "Like") { liked.toggle() }
          .accessibilityIdentifier("like_button")
          // Long-pressing SELECT opens the context menu: tvOS's native long press.
          .contextMenu {
            Button("Reset like") { liked = false }
              .accessibilityIdentifier("context_reset")
          }
      }
    }
    .onAppear { log.notice("toets-fixture: details item=\(item)") }
  }
}

/// A fake player: no media, just a playing/paused state driven by the remote's play/pause.
struct PlayerView: View {
  let item: Int
  @State private var playing = true

  var body: some View {
    VStack(spacing: 40) {
      Text("Player Item \(item)")
        .accessibilityIdentifier("player_title")
      Text(playing ? "playing" : "paused")
        .accessibilityIdentifier("player_state")
      Button("Toggle") { toggle() }
        .accessibilityIdentifier("player_toggle")
    }
    .onPlayPauseCommand { toggle() }
  }

  private func toggle() {
    playing.toggle()
    log.notice("toets-fixture: player \(playing ? "playing" : "paused", privacy: .public)")
  }
}
