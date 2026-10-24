/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The starter template of a video workflow (Video Sequence, "Starter template
 * and local data"): a brief, a script, and a first shot as ordinary notes, a
 * video draft, and an empty Sequence, with the cards and connections the
 * canvas makes from it. It is part of the application, as the canvas's own
 * code is (D75), and the canvas reads it as it reads any template.
 */
export const BASEHALF_STARTER_WORKFLOW_TEMPLATE = Object.freeze(
{
	version: 1,
	files: [
		{
			path: 'README.md',
			contents: `# Video workflow

This folder keeps the brief, the script, the shot plans, and the clip order as ordinary local files. Ask an Agent to expand or revise the workflow, or edit any note and video card directly.

## Shots

Each shot folder has a plan, a sound plan, and a video card, which waits for its video until it generates. The notes connected to a video card join its prompt, so the plan of a shot describes its clip. Choose a model in the card's panel and press Generate; the video is saved in the shot's folder under the card's name, \`clip.mp4\`.

## Clip order

\`video-sequence.json\` lists videos in playback order. Each item keeps the video's relative path and, for a video BaseHalf generated, which generation made it, so that a moved video can be found again. Use **BaseHalf: Add Video Result to Sequence…** to add a video, **BaseHalf: Show Video Sequence Status…** to check every item, **BaseHalf: Move Video Sequence Clip…** to change the order, **BaseHalf: Repair Moved Video Sequence Clip…** to follow a moved video, and **BaseHalf: Remove Video Sequence Clip…** to remove only the reference.
`
		},
		{
			path: 'brief.md',
			contents: `# Creative brief

Describe the story, audience, format, visual direction, duration, and non-negotiable constraints.
`
		},
		{
			path: 'script.md',
			contents: `# Script

Turn the creative brief into scenes, action, and dialogue. Keep each intended shot easy to identify.
`
		},
		{
			path: 'shots/shot-01/storyboard.md',
			contents: `# Shot 01

## Visual beat

Describe what the viewer sees.

## Camera and motion

Describe framing, camera movement, subject movement, and timing.

## Continuity

Record what must match the shots before and after this one.
`
		},
		{
			path: 'shots/shot-01/audio-plan.md',
			contents: `# Shot 01 sound

## Dialogue

Write the lines spoken in this shot and who speaks them.

## Music and effects

Describe the music, ambience, and sound effects, and when they start.
`
		},
		{
			path: 'shots/shot-01/shot.json',
			contents: `{
  "version": 1,
  "kind": "pointa.basehalf-ai-video.shot",
  "id": "shot-01",
  "title": "Shot 01",
  "clipNodePath": "clip.mp4"
}
`
		},
		{
			path: 'video-sequence.json',
			contents: `{
  "version": 1,
  "kind": "pointa.basehalf-ai-video.sequence",
  "items": []
}
`
		}
	],
	drafts: [
		{ path: 'shots/shot-01/clip.mp4' }
	],
	cards: [
		{ path: 'brief.md', x: 40, y: 120, width: 300, height: 220 },
		{ path: 'script.md', x: 420, y: 120, width: 300, height: 220 },
		{ path: 'video-sequence.json', x: 800, y: 120, width: 300, height: 220 },
		{ path: 'shots/shot-01/storyboard.md', x: 40, y: 80, width: 340, height: 300 },
		{ path: 'shots/shot-01/audio-plan.md', x: 40, y: 440, width: 340, height: 240 },
		{ path: 'shots/shot-01/clip.mp4', x: 480, y: 160, width: 720, height: 405 },
		{ path: 'shots/shot-01/shot.json', x: 1280, y: 160, width: 300, height: 220 }
	],
	references: [
		{ from: 'brief.md', to: 'script.md', fromAnchor: 'east', toAnchor: 'west' },
		{ from: 'script.md', to: 'shots/shot-01/storyboard.md', fromAnchor: 'east', toAnchor: 'west' },
		{ from: 'shots/shot-01/storyboard.md', to: 'shots/shot-01/clip.mp4', fromAnchor: 'east', toAnchor: 'west' },
		{ from: 'shots/shot-01/audio-plan.md', to: 'shots/shot-01/clip.mp4', fromAnchor: 'east', toAnchor: 'west' }
	]
});

/** The template as the canvas reads it. */
export const BASEHALF_STARTER_WORKFLOW_TEMPLATE_SOURCE = JSON.stringify(BASEHALF_STARTER_WORKFLOW_TEMPLATE);
