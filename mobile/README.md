# Cosign mobile

Flutter client for Android and iOS. Sign in with the buyer account you use on the Cosign website. The app uses the existing production workspace API for catalog search, requests, supplier evidence, versioned approvals, account rules, and activity.

## Run

Use Flutter 3.50 or newer with the Android SDK or Xcode set up. From this directory:

```sh
flutter pub get
flutter devices
flutter run -d <device-id>
```

The default endpoint is `http://localhost:8080`, which works in the iOS Simulator when the workspace runs on the same Mac. To use a hosted workspace, pass its HTTPS origin when launching the app. [HTTPS setup](../docs/production-mcp.md#optional-ngrok-tunnel)

```sh
flutter run -d <device-id> --dart-define=COSIGN_API_URL=https://cosign.example.com
```

Use an origin with no path. The Cosign server's `PUBLIC_ORIGIN` must match the origin used for API writes. For a server running at `http://localhost:8080`, use the following in a debug build.

- iOS Simulator: `--dart-define=COSIGN_API_URL=http://localhost:8080`
- Android Emulator: `--dart-define=COSIGN_API_URL=http://10.0.2.2:8080 --dart-define=COSIGN_PUBLIC_ORIGIN=http://localhost:8080`

Use the workspace’s HTTPS origin on physical devices. Release builds require it in `--dart-define=COSIGN_API_URL`, using the same value as in the example above. To install on a physical iPhone or distribute either build, configure signing for your own developer account in the platform project.

## Assistant and personalization

The app submits assistant jobs to the Cosign backend. Configure its existing `NVIDIA_API_KEY` and optional `NEMOTRON_MODEL` to enable Nemotron. The app reads model availability from the server session.

The first-visit questions and display preferences stay on the device. Answers personalize the products and searches shown on the overview and fill in an editable planning message. The user sends the message to the assistant. Monthly budget is planning context. The account spending limit is managed in Purchasing rules.

Drift stores the current account's catalog basket and last retrieved requests so they can be shown when the service is briefly unavailable during a session. Session credentials use Keychain on iOS and secure storage on Android.

## Review and rehearsal

Open **New request** from the overview or select a request from **Needs your attention**. Request details show the draft total, the automatic spending limit or review notes, and recent actions. Approval applies to the displayed revision.

When the server advertises order rehearsal, a draft within automatic authority or approved by the buyer can be saved as a simulated receipt. The receipt shows the fixed amount and who authorized it. Rehearsal sends nothing to the supplier.

## Verify

```sh
flutter analyze
flutter test
flutter build apk --debug
flutter build ios --simulator --debug
```

Regenerate the checked-in Drift code after schema changes with `dart run build_runner build`.
