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

  const api = { visibleTools };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, { menu: api });
})(typeof self !== 'undefined' ? self : this);
