# Magnet Mayhem

One-finger magnetic physics arcade game. Native Android app (Capacitor wraps the HTML5 canvas game in a real APK/AAB). Ads are not active yet, but the code is already structured for them.

You don't control the ball. You control the forces around it.

## How it plays

- Hold the **left** half of the screen: blue magnets (and purple ones in attract phase) pull the ball.
- Hold the **right** half: red magnets (and purple ones in repel phase) push the ball.
- Black magnets and spikes kill you. Energy drains over time and coins refill it, so you have to keep moving.
- Desktop testing: `A` / left arrow = attract, `L` / right arrow = repel.

Core systems in `www/js/game.js`: infinite chunked world (seeded, so the Daily Challenge shares a layout), 120 Hz fixed physics step, slingshot and near-miss detection, combo and multiplier, five power-ups, four special events, tutorial, skins, achievements, local top 10.

## Run it in a browser (quick feel test)

```
npm install
npm run serve        # http://localhost:8080  (use phone emulation in DevTools)
npm test             # headless smoke test of the game logic
```

## Build the Android app

### Option A: GitHub Actions (no Android Studio needed)
1. Push this folder to a GitHub repo (the `android/` folder is already generated and committed).
2. The workflow in `.github/workflows/android.yml` builds on every push to `main`.
3. Download `magnet-mayhem-debug-apk` from the run's artifacts and install it on a phone.

### Option B: Android Studio
```
npm install
npx cap sync android
npx cap open android
```
Then Run on a device, or Build > Generate Signed Bundle (AAB) for Google Play.

Requires Node 22 and JDK 21 (Capacitor 8).

## Publishing checklist (Google Play)

- The app ID is `com.golamlab.magnetmayhem` (set in `capacitor.config.json` and the `android/` project). It cannot change after the first Play upload.
- Replace the default launcher icon (Android Studio: right-click `res` > New > Image Asset).
- Sign the release AAB with your own upload keystore. Keep the keystore out of git (already in `.gitignore`).
- Add a privacy policy URL in Play Console. It is required once ads are on.

## Adding ads later (AdMob)

All ad calls go through `www/js/ads.js`, and everything is a no-op until you enable it. Placements are already wired in `game.js`:

| Placement | Where | Rule |
|---|---|---|
| Banner | Menu and game-over screens only | Never during play, so no mis-taps |
| Interstitial | When tapping PLAY AGAIN | Every 4th run, never in the first 3, at least 90 s apart |
| Rewarded | "REVIVE (WATCH AD)" on game over | Once per run, only if the run lasted 15 s+ |

Steps:
1. `npm install @capacitor-community/admob`
2. Add your AdMob **App ID** to `android/app/src/main/AndroidManifest.xml` inside `<application>`:
   ```xml
   <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"/>
   ```
   The app crashes at launch if the plugin is installed without this tag. For testing, use Google's sample App ID `ca-app-pub-3940256099942544~3347511713`.
3. In `www/js/ads.js` set `enabled: true`. Keep `testMode: true` while developing (the file already holds Google's public test unit IDs).
4. Create your three ad units in AdMob (banner, interstitial, rewarded) and paste the IDs into `ads.ids`, then set `testMode: false` for release.
5. `npx cap sync android`, rebuild.
6. The consent form (GDPR/UMP) is requested automatically in `Ads.init()`. Configure the message in the AdMob console.

The ad code was written against the plugin's documented API but has not been run on a device yet, so test on a real phone before release.

## Not built yet

- Global Daily Challenge ranking and leaderboard (needs a backend, e.g. Supabase, or Google Play Games Services). Today scores are stored on the device only; the UI already shows the rank slot.
- Custom launcher icon and splash screen.
