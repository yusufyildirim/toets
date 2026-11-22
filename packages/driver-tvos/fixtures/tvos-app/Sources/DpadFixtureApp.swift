// Minimal tvOS app the tvOS driver's integration tests run against. Plain SwiftUI, no dpad
// SDK: it proves the driver works black-box on any native app. Every element tests touch has
// an accessibility identifier (dpad's testId on tvOS).

import SwiftUI
import os

private let log = Logger(subsystem: "tv.dpad.fixture", category: "app")

/// The part of dpad's launch payload this fixture reads. dpad passes it as the launch
/// arguments `-__dpad <JSON>`, which UserDefaults exposes under the key `__dpad`.
struct LaunchPayload: Decodable {
  let v: Int
  let state: String?
}

func readLaunchPayload() -> LaunchPayload? {
  guard let raw = UserDefaults.standard.string(forKey: "__dpad"),
    let data = raw.data(using: .utf8)
  else { return nil }
  return try? JSONDecoder().decode(LaunchPayload.self, from: data)
}

enum Route: Hashable {
  case details(Int)
  case player(Int)
}

@main
struct DpadFixtureApp: App {
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
      log.notice("dpad-fixture: launched state=\(payload?.state ?? "none", privacy: .public)")
      // App-defined launch state, the way an app would apply the payload's `state`.
      if payload?.state == "details" { path = [.details(1)] }
    }
  }
}

struct HomeView: View {
  let payloadState: String

  var body: some View {
    VStack(alignment: .leading, spacing: 40) {
      Text("dpad fixture")
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
        Button("Settings") { log.notice("dpad-fixture: settings") }
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
    .onAppear { log.notice("dpad-fixture: details item=\(item)") }
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
    log.notice("dpad-fixture: player \(playing ? "playing" : "paused", privacy: .public)")
  }
}
