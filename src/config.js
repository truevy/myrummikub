// Connection details for online play. These values identify the Firebase
// project the app talks to; they are meant to be public. What protects the
// data is the rules in database.rules.json. See docs/online.md for setup.
(function (root) {
  root.RK = Object.assign(root.RK || {}, {
    CLOUD: {
      firebase: {
        apiKey: 'AIzaSyCm8bI4i7Z7Q25rB575idBojaD44Ku7Jko',
        authDomain: 'lyndas-rummikub.firebaseapp.com',
        databaseURL: 'https://lyndas-rummikub-default-rtdb.firebaseio.com',
        projectId: 'lyndas-rummikub',
        appId: '1:485486594044:web:f08a90bc68b31944d21479',
      },
      // the link scheme the app registers, e.g. lyndas-rummikub://join?t=…
      scheme: 'lyndas-rummikub',
      // where someone without the app can download it
      releasesUrl: 'https://github.com/truevy/myrummikub/releases/latest',
      // how long the mover may be offline before their turn can be skipped
      skipAfterMs: 60 * 1000,
      // how long an invitation link stays valid
      inviteTtlMs: 24 * 60 * 60 * 1000,
    },
  });
})(typeof self !== 'undefined' ? self : this);
