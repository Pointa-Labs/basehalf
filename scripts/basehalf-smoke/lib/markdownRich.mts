/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The frame of the rich Markdown editor, and composing text in it.

export async function dispatchMarkdownRichComposition(frame, type) {
	await frame.evaluate(eventType => {
		const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		const target = active?.closest('.ProseMirror[contenteditable="true"], .bn-editor[contenteditable="true"]')
			?? document.querySelector('.ProseMirror[contenteditable="true"], .bn-editor[contenteditable="true"]');
		if (!(target instanceof HTMLElement)) {
			throw new Error('The active rich editor DOM target was unavailable for IME composition');
		}
		target.dispatchEvent(new CompositionEvent(eventType, { bubbles: true, cancelable: true }));
	}, type);
}

export async function activeMarkdownRichFrame(page, ownerSelector) {
	const started = Date.now();
	let lastFrameUrls = [];
	while (Date.now() - started < 20_000) {
		const frames = page.frames();
		lastFrameUrls = frames.map(frame => frame.url()).filter(Boolean);
		for (const frame of frames) {
			const editorCount = await frame.locator('.basehalf-markdown-rich.ready .bn-editor').count().catch(() => 0);
			if (editorCount > 0 && await markdownRichFrameBelongsTo(frame, ownerSelector)) {
				return frame;
			}
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Markdown rich editor webview was not ready. Frames: ${lastFrameUrls.join(', ')}`);
}

export async function markdownRichFrameBelongsTo(frame, ownerSelector) {
	if (!ownerSelector) {
		return true;
	}
	let ownerFrame = frame;
	const mainFrame = frame.page().mainFrame();
	while (ownerFrame.parentFrame() && ownerFrame.parentFrame() !== mainFrame) {
		ownerFrame = ownerFrame.parentFrame();
	}
	const frameElement = await ownerFrame.frameElement().catch(() => undefined);
	return frameElement
		? frameElement.evaluate((element, selector) => element.closest(selector) !== null, ownerSelector).catch(() => false)
		: false;
}
