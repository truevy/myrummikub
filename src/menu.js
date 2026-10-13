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
      newGame: true,
    };
  }

  // The Notifications row in Settings. state: what iOS says about this app, 'granted',
  // 'denied' or 'undecided'; null when it is not known; available: false outside the
  // iPhone and iPad app. Returns { text, action }, action being null, 'enable' (ask
  // iOS now) or 'settings' (only the person can turn it on, in iOS Settings).
  function notificationRow(state, available) {
    if (!available) return { text: 'Notifications are available in the iPhone and iPad app.', action: null };
    if (state === 'granted') return { text: 'On. You will hear when it is your turn in a game, and when someone invites you.', action: null };
    if (state === 'denied') return { text: 'Off. Turn them on in iOS Settings to hear when it is your turn.', action: 'settings' };
    if (state === 'undecided') return { text: 'Not on yet. Turn them on to hear when it is your turn, even when the app is closed.', action: 'enable' };
    return { text: 'Checking…', action: null };
  }

  const api = { visibleTools, notificationRow };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, { menu: api });
})(typeof self !== 'undefined' ? self : this);
