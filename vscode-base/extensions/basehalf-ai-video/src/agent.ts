/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { AIProject } from './model';

export function createAIVideoAgentBrief(projectPath: string, project: AIProject): string {
	return `You are helping build an AI video production workflow in BaseHalf.

Project file: ${projectPath}
Project title: ${project.title}
Creative objective: ${project.brief.objective || 'The user has not filled this in yet. Infer a useful draft, then clearly report the assumption.'}

Read the existing .aivideo file before editing it. It is ordinary local JSON and is the source of truth. Build or refine a complete version 3 workflow that covers:

1. A clear creative brief with audience, format, aspect ratio, duration, and language.
2. A production-ready script with beats, action, dialogue, and narration where relevant.
3. Reusable character, scene, and visual-direction context.
4. A shot sequence that functions as the storyboard.
5. A provider-neutral execution prompt for every shot.

For each shot, fill title, storyboard, camera, motion, prompt, negativePrompt, dialogue, audio, durationSeconds, startFrame, and endFrame. Prompts should use direct physical descriptions. Separate what appears in frame from how it moves. Include camera framing or movement, subject action, environment, lighting or style, timing, and sound when relevant. Do not invent reference file paths.

Workflow rules:

- The required node ids are "brief" and "script".
- Every item in characters, scenes, styles, and shots has one matching workflow node with the same id and kind.
- Keep node ids stable when refining existing content.
- Keep numeric node positions usable: Brief and Script on the left, reusable context in the middle, Shots in story order on the right, with roughly 320 horizontal or 220 vertical pixels between neighboring cards. Do not overlap nodes.
- Edges are directed and acyclic.
- An edge kind is "sequence" only for shot-to-shot continuity. Every other edge kind is "context".
- Connect brief to script, script to relevant scenes, reusable character/style context to affected shots, scenes to their shots, and shots to later shots when continuity depends on the previous result.
- Give each shot at most one current Scene context. A sequence edge passes the prior Shot result; it does not replace the target Shot's creative context.
- A shot's sceneId must match its incoming scene context edge.
- Keep videoProvider as "prompt-package" until the user configures a real connector. Keep voiceProvider as "none" unless a voice connector is already present.
- Preserve existing outputs and prior run paths. Do not execute a paid provider unless the user explicitly asks.

Save the valid JSON directly to ${projectPath}. Do not create a second project file and do not wrap the JSON in Markdown. BaseHalf will reload the canvas from the external file change. After saving, summarize the story structure, shot count, continuity strategy, and any assumptions that still need user review.`;
}
