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
    version: 'v2.15.0',
    date: '2026-09-03',
    changes: [
      'Home is reordered around what actually changes. It now opens on the ' +
        'week ahead and today\u2019s sun, then this month so far, with the ' +
        'all-time total and payback underneath. Before this, the first thing ' +
        'on screen was a figure that only moved once a month.',
      'Home tells you when a month has not been uploaded. Nothing in the app ' +
        'used to say this, so a skipped upload left every screen quietly ' +
        'showing older numbers with no sign anything was missing.',
      'One line at the top of Home names the best solar day this week and ' +
        'roughly how much of it is spare for the car.',
      'The total saved, the payback ring and the milestones are one panel ' +
        'instead of three. The ring and the milestone list had been giving ' +
        'the same \u201Cto go\u201D figure twice.'
    ]
  },
  {
    version: 'v2.14.1',
    date: '2026-09-03',
    changes: [
      'The separate weekend card is gone from the 7-day forecast. Saturday ' +
        'and Sunday sit next to each other in the week strip already, on the ' +
        'same scale and the same shading, so the card was drawing the same ' +
        'two days a second time. Tap either one for the full day.'
    ]
  },
  {
    version: 'v2.14.0',
    date: '2026-09-03',
    changes: [
      'The 7-day forecast is now one picture instead of three. All seven days ' +
        'stand side by side as columns you can compare at a glance, so a day ' +
        'off no longer has to be looked up behind a toggle - it is already on ' +
        'screen.',
      'Tap any day to see it in full underneath: what it should give, the ' +
        'likely range, the temperatures, and how much is going spare for the ' +
        'car. It opens on today.',
      'Each column is one day, and brighter means a bigger day - the same ' +
        'shading the day-by-day calendar already uses for the month behind ' +
        'you. The range a figure could land in is on the day\'s own card, in ' +
        'words, rather than drawn onto the column.',
      'Each day now shows what the sky is doing - clear, some cloud, overcast ' +
        'or showers. The app was already being told this and was throwing it ' +
        'away.',
      'The This month / Range / All time buttons on Energy, Car and Money are ' +
        'now one slim control instead of three chunky ones, giving about a ' +
        'third of a screen-inch back to the content underneath.',
      'Sunrise and sunset have gone from the Energy forecast. They were ' +
        'printed twice and said the same thing both times; Home still shows ' +
        'them drawn against the shape of the day.',
      'The whole panel is shorter than the old one was even before you opened ' +
        'it, and about 40% shorter than it became once you had.',
      'Fixed the sun curve on Home spilling outside its card.'
    ]
  },
  {
    version: 'v2.13.0',
    date: '2026-09-02',
    changes: [
      'Your data can now be backed up off this phone, encrypted. Data → Cloud ' +
        'Backup asks for a passphrase, scrambles the whole store on this device, ' +
        'and uploads only the scrambled version, so the service holding it cannot ' +
        'read a single figure. On a new phone, sign in and pull it back.',
      'Signing in uses your Supabase account email and password, entered once per device. That is a different secret from the passphrase below: the password only proves who you are and can be reset, the passphrase is what makes the data unreadable.',
      'The passphrase cannot be recovered. If you lose it, that copy is gone, ' +
        'so use the same one each time and write it down somewhere safe.',
      'This is a SECOND copy, not a replacement for the file backup. Keep ' +
        'exporting files as well: the free cloud service goes to sleep when it ' +
        'is not used, and is cleared out if it sleeps for three months.',
      'The Data screen now nags separately when the cloud copy has fallen ' +
        'behind, the same way it already nags about the file backup.'
    ]
  },
  {
    version: 'v2.12.0',
    date: '2026-09-02',
    changes: [
      'Home now draws the day itself: sunrise to sunset, with the forecast ' +
        'solar spread across the hours the sun is expected to arrive in, and a ' +
        'mark showing how much of it is still to come. One tap for tomorrow.',
      'The shape is the weather forecast\'s own hour-by-hour sunshine, so a ' +
        'cloudy morning shows as a dip rather than a smooth hill. The day\'s ' +
        'total is the same figure the Energy screen gives.',
      'Today and tomorrow on the 7-day forecast now say when the sun rises and ' +
        'sets, and how long it is up for.'
    ]
  },
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
