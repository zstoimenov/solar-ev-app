// Money - what has it saved, and when does it pay back?
//
// Wraps the existing ROI Layers and Payback Progress tiles unchanged. The
// only thing this screen changes is that both are visible on arrival rather
// than collapsed behind a heading.

import React from 'react';
import RoiLayers from '../Dashboard/RoiLayers.jsx';
import PaybackProgress from '../Dashboard/PaybackProgress.jsx';

export default function Money({ state }) {
  return (
    <div className="screen">
      <div className="panel">
        <h3 className="panel-title">Three separate savings</h3>
        <RoiLayers state={state} />
      </div>
      <div className="panel">
        <h3 className="panel-title">Paying back the hardware</h3>
        <PaybackProgress state={state} />
      </div>
    </div>
  );
}
