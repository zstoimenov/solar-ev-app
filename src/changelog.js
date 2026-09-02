// changelog.js - what changed, in the household's words rather than the
// repository's. The "What's new" modal in the header shows the NEWEST entry
// only; the older ones stay here as the record, and as the shape to copy when
// adding the next.
//
// APP_VERSION in version.js is derived from the top entry, so the number in
// the header and the number in these notes cannot drift apart. Adding a
// release means adding one entry here - there is no second place to update.
//
// Keep the entries in the register the app uses everywhere else: what it now
// does for the household, not which module was refactored. "The forecast now
// says how wrong it has been" is a change; "extracted rawKwhFor()" is not.

export const CHANGELOG = [
  {
    version: 'v2.11.0',
    date: '2026-09-02',
    changes: [
      'The Data screen is now a list of everything on it, one tap to any page, ' +
        'instead of two rows of buttons that wrapped to three lines on a phone.',
      'Today is now called Home: most of what it shows - the total saved, ' +
        'payback, the milestones - is all-time, not today.',
      'This panel now shows what changed in the version you are running.',
      'A clearer car icon, and a banknote for Money.'
    ]
  },
  {
    version: 'v2.10.0',
    date: '2026-09-02',
    changes: [
      'Your phone can now tell you which day to charge on: the weekend, the ' +
        "week's best day, and a tomorrow that stands out. Turn them on under " +
        'Data, then Alerts.',
      'Nothing is sent to a server to do it - the phone works it out itself, ' +
        'and anything it could not deliver is shown when you next open the app.',
      'Ordinary days say nothing. At most one alert a day, and none at night.'
    ]
  },
  {
    version: 'v2.9.0',
    date: '2026-09-02',
    changes: [
      'The kWh forecast now knows the time of year: hot summer days derate the ' +
        'panels and a low winter sun meets more shade, and the fit follows both.',
      'Recent days count for more than old ones, so soiling and panel ageing ' +
        'show up instead of being averaged away.',
      '"Spare for the car" is now measured from what actually went spare on ' +
        'past days like the one forecast, rather than subtracting an average.'
    ]
  },
  {
    version: 'v2.8.0',
    date: '2026-09-02',
    changes: [
      'The forecast now checks its own homework: every figure it shows is ' +
        'recorded and later compared with what the roof really produced.',
      'The range on each day is measured rather than assumed, so tomorrow is ' +
        'drawn tighter than Sunday.',
      'The yield is calibrated against the same weather models that produce the ' +
        'forecast, instead of a different archive - which had been quietly ' +
        'scaling every projection.'
    ]
  }
];

export const LATEST = CHANGELOG[0];
