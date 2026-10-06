'use strict';
/*
 * Ads layer. The game only talks to this object, so turning ads on later is a
 * config change plus one plugin install (see README, "Adding ads").
 *
 * Planned placements (kept away from gameplay so they never cause mis-taps):
 *   - Banner: menu and game-over screens only
 *   - Interstitial: after every Nth finished run, never in the first 3 runs
 *   - Rewarded: "Revive" button on the game-over screen
 *
 * While ads.enabled is false (the default) every call is a safe no-op.
 */
const Ads = (() => {
  const cfg = {
    enabled: false,          // flip to true after installing the AdMob plugin
    testMode: true,          // keep true until Google has approved your account/app
    interstitialEvery: 4,    // show one interstitial every N finished runs
    interstitialMinGapMs: 90000,
    // Google's public TEST ad unit IDs. Replace with your own before release.
    ids: {
      banner: 'ca-app-pub-3940256099942544/6300978111',
      interstitial: 'ca-app-pub-3940256099942544/1033173712',
      rewarded: 'ca-app-pub-3940256099942544/5224354917'
    }
  };

  let ready = false, runs = 0, lastInterstitial = 0, bannerOn = false;
  const plugin = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) || null;

  async function init() {
    if (!cfg.enabled || ready) return;
    const A = plugin();
    if (!A) return;
    try {
      // GDPR / UMP consent form (required for users in the EEA and UK).
      try {
        const info = await A.requestConsentInfo();
        if (info.isConsentFormAvailable && info.status === 'REQUIRED') await A.showConsentForm();
      } catch (e) { /* consent not available, continue */ }
      await A.initialize({ initializeForTesting: cfg.testMode });
      ready = true;
      document.body.classList.add('ads-on');
    } catch (e) { ready = false; }
  }

  async function banner(show) {
    const A = plugin();
    if (!cfg.enabled || !ready || !A) return;
    try {
      if (show && !bannerOn) {
        await A.showBanner({ adId: cfg.ids.banner, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: cfg.testMode });
        bannerOn = true;
      } else if (!show && bannerOn) {
        await A.removeBanner();
        bannerOn = false;
      }
    } catch (e) { /* ignore */ }
  }

  // Call when a run ends. Returns a promise that resolves once any ad is closed.
  async function maybeInterstitial() {
    runs++;
    const A = plugin();
    if (!cfg.enabled || !ready || !A) return;
    if (runs < 3 || runs % cfg.interstitialEvery !== 0) return;
    if (Date.now() - lastInterstitial < cfg.interstitialMinGapMs) return;
    try {
      await A.prepareInterstitial({ adId: cfg.ids.interstitial, isTesting: cfg.testMode });
      await A.showInterstitial();
      lastInterstitial = Date.now();
    } catch (e) { /* ignore */ }
  }

  // Resolves true only if the player earned the reward.
  async function rewarded() {
    const A = plugin();
    if (!cfg.enabled || !ready || !A) return false;
    try {
      await A.prepareRewardVideoAd({ adId: cfg.ids.rewarded, isTesting: cfg.testMode });
      const r = await A.showRewardVideoAd();
      return !!r;
    } catch (e) { return false; }
  }

  return {
    init, banner, maybeInterstitial, rewarded,
    get enabled() { return cfg.enabled && ready; }
  };
})();
