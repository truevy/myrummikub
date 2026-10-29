// Which tools the ☰ menu offers. The same list is used at every moment of a
// game, so the top bar does not change as the game goes on. No DOM, usable
// from node.
(function (root) {
  // ctx: { online, hasComputer, over }
  function visibleTools(ctx) {
    const { online, hasComputer, over } = ctx;
    return {
      pause: hasComputer && !online && !over, // pausing only makes sense while a computer plays
      speed: hasComputer && !online,
      sound: true,
      settings: true,
      online: true,
      save: !online, // an online game lives on the server, not in a file
      load: true,
      quit: !online && !over, // a game on this computer can be stopped; an online game is left from its list
      abandon: online && !over, // an online game is left by dropping out of it
      newGame: true,
    };
  }

  // The Notifications row in Settings. state: what the device says about this app,
  // 'granted', 'denied' or 'undecided'; null when it is not known. kind says where the
  // app runs: true on an iPhone, iPad or Android device (notifications reach a closed
  // app), 'desktop' on a Mac or Windows PC (notifications while the app is running, which
  // it keeps doing in the menu bar or tray after its window is closed), false in a
  // browser. Returns { text, action }, action being null, 'enable' (ask now) or
  // 'settings' (only the person can turn it on, in the device's Settings).
  function notificationRow(state, kind) {
    if (!kind) return { text: 'Notifications are available in the phone, tablet, Mac and Windows apps.', action: null };
    if (kind === 'desktop') {
      if (state === 'denied') return { text: 'Off. Turn them on in your system settings to hear when it is your turn.', action: 'settings' };
      return {
        text: 'On while the game is running. Closing the window leaves it running in the background (menu bar or tray), so you still hear when it is your turn. Quit the game from its menu and you will not.',
        action: null,
      };
    }
    if (state === 'granted') return { text: 'On. You will hear when it is your turn in a game, and when someone invites you.', action: null };
    if (state === 'denied') return { text: 'Off. Turn them on in your device Settings to hear when it is your turn.', action: 'settings' };
    if (state === 'undecided') return { text: 'Not on yet. Turn them on to hear when it is your turn, even when the app is closed.', action: 'enable' };
    return { text: 'Checking…', action: null };
  }

  const api = { visibleTools, notificationRow };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, { menu: api });
})(typeof self !== 'undefined' ? self : this);
