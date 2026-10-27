/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The canvas core: the canvas view, which creates the features registered below.
import './browser/basehalfCanvasWorkbench.contribution.js';
// A pinch over a PDF or a book in Card Detail, which the window takes, reaches its page.
import '../cardDetail/browser/basehalfCardDetailPagePinch.js';

// Canvas features, each in its own folder under canvasContrib/. They register
// themselves with the canvas, which never imports them; their view controls
// appear in this order (docs/harness/code-organization.md).
import '../canvasContrib/tidy/browser/basehalfCanvasTidy.contribution.js';
import '../canvasContrib/snap/browser/basehalfCanvasSnap.contribution.js';
import '../canvasContrib/zoom/browser/basehalfCanvasZoom.contribution.js';
import '../canvasContrib/videoPanel/browser/basehalfCanvasVideoPanel.contribution.js';
