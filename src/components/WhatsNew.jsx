// WhatsNew - the header's ⓘ panel. It shows the version being run and what
// changed in it, and nothing else.
//
// It used to be Data Notes: a list of data caveats (a provisional feed-in
// rate, months awaiting a Synergy bill, the servicing step-change). Those were
// context about the numbers rather than something to act on, and they made the
// one panel reachable from every screen a place nobody opened twice. The
// caveats that still matter are stated where the numbers they qualify are
// shown, which is where a caveat belongs.
//
// Only the newest release is listed, deliberately. Someone opening this wants
// to know what changed since they last looked, not to read a history.

import React from 'react';
import { LATEST } from '../changelog.js';

export default function WhatsNew() {
  return (
    <>
      <p className="whats-new-version">
        <strong>{LATEST.version}</strong>
        <span className="small"> · {LATEST.date}</span>
      </p>
      <ul className="notes-list">
        {LATEST.changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
    </>
  );
}
