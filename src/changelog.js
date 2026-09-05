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
    version: 'v2.19.1',
    date: '2026-09-05',
    changes: [
      'New app icon. The old sun ran its rays to the very edge of the ' +
        'square, and Android is entitled to crop an installed icon to a ' +
        'circle \u2014 so on the home screen the rays were cut off and what ' +
        'was left was a yellow blob.',
      'The new one is a sun over three rising bars, drawn well inside that ' +
        'circle so nothing is lost whichever shape your phone crops it to. ' +
        'The bars are the app\u2019s money colour: this tracks a return, not ' +
        'just the weather.',
      'Your phone may hold on to the old icon for a while. Removing the app ' +
        'from the home screen and installing it again picks up the new one.'
    ]
  },
  {
    version: 'v2.19.0',
    date: '2026-09-05',
    changes: [
      'Spare solar can now be read in the units your car shows. Enter your ' +
        'battery size and average consumption under Data \u2192 EV charging data ' +
        '\u2192 Your Car, and every place the app says how much energy is going ' +
        'spare also says what share of the battery that is and how far it goes.',
      'Both figures are optional and independent \u2014 fill in one and you get ' +
        'that one, leave both blank and nothing changes.',
      'They are a ceiling, not a promise: a little of the energy becomes heat ' +
        'rather than charge on the way into the pack, and the app will not ' +
        'guess how much.'
    ]
  },
  {
    version: 'v2.18.0',
    date: '2026-09-05',
    changes: [
      'Adding a month now starts with the files. Picking one reads the month ' +
        'out of its name, each slot shows what you actually chose, and if the ' +
        'Fronius and Wattpilot files turn out to be from different months it ' +
        'says so before anything is built.',
      'The storage warning is readable again. It was capped at a height that ' +
        'cut off its first and last line on a phone, with the buttons landing ' +
        'over the text.',
      'The weather forecast can be turned down. “Not now” leaves one ' +
        'line on Energy to turn it back on and stops Car asking as well.',
      'A part-finished month now says so on the Money screen, instead of ' +
        'showing four days’ electricity as though it were the whole bill.',
      'Fixed a sentence on Home that read “7% below than an typical ' +
        'August”.'
    ]
  },
  {
    version: 'v2.17.2',
    date: '2026-09-04',
    changes: [
      'Home no longer says the same thing twice. Once a month has ended, ' +
        '\u201CAugust so far \u2014 day 31 of 31\u201D is gone and only the ' +
        'full write-up of that month remains; the pace panel comes back when ' +
        'there is a month actually in progress to pace.'
    ]
  },
  {
    version: 'v2.17.1',
    date: '2026-09-04',
    changes: [
      'Tapping a day in the week ahead now shows it in two lines instead of ' +
        'three, with the figure and its likely range using the space that ' +
        'used to sit empty beside the date.',
      'The line that read \u201CThe best day this week\u201D is a small tag ' +
        'beside the date now. The panel already names the best day at the ' +
        'top, in larger type.'
    ]
  },
  {
    version: 'v2.17.0',
    date: '2026-09-04',
    changes: [
      'Home now says what the month just gone actually did, in plain ' +
        'sentences: what the roof made against a typical month of the same ' +
        'name, how much of the house ran on its own power, and where the ' +
        'car\u2019s energy came from.',
      'It also says WHY the saving moved. Every screen could tell you the ' +
        'saving was $23 lower than a year ago; none of them could tell you ' +
        'that was the feed-in rate being cut rather than anything you did. ' +
        'The breakdown names the biggest cause, and splits it into how much ' +
        'energy moved versus what it was worth.',
      'Compare against the same month a year earlier or the month before, ' +
        'whichever question you are asking.',
      'The breakdown checks its own arithmetic. If the parts do not add up ' +
        'to the change in the total, it shows the gap as its own row instead ' +
        'of quietly spreading it across the others.'
    ]
  },
  {
    version: 'v2.16.0',
    date: '2026-09-04',
    changes: [
      'Swipe left or right anywhere on a screen to move between Home, ' +
        'Energy, Car, Money and Data, in the order the bar at the bottom ' +
        'shows them. Tables that scroll sideways still scroll sideways.',
      'Each day in the week ahead now shows the sunlight figure the forecast ' +
        'itself is working from, beside the date, so it can be checked ' +
        'against any other forecast quoting the same number.',
      'The week ahead lost the four lines underneath it. How the estimate is ' +
        'fitted, and how close it has been landing, are behind the ' +
        '\u201Ci\u201D now; the time it was last checked stays on screen, ' +
        'because a cached forecast otherwise looks like a fresh one.',
      'Changing your area is a button at the top of that panel instead of the ' +
        'bottom, and your saved area and coordinates are shown inside it ' +
        'rather than printed under the week every time you open the app.'
    ]
  },
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
