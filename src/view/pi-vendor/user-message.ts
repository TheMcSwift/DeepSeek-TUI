import { Box, Container, Markdown, Text, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "./extensions-types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private text: string;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	/** cc classic（regular 默认）：`❯` 前缀 + 纯文本回显（无气泡）；否则气泡（fullscreen）。 */
	private classic: boolean;
	/** V2: fullscreen 消息归属标签（`You`，气泡上方一行）。 */
	private label?: string;
	/** Optional one-line footer under the bubble (T3① message clock). */
	private footerText?: Text;

	constructor(
		text: string,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		classic = false,
		label?: string,
	) {
		super();
		this.text = text;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.classic = classic;
		this.label = label;
		this.rebuild();
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		this.rebuild();
	}

	/** Set (or clear) the one-line footer under the bubble (T3① clock). */
	setFooter(text: string | undefined): void {
		this.footerText = text === undefined ? undefined : new Text(text);
		this.invalidate();
	}

	private rebuild(): void {
		this.clear();
		const markdown = new Markdown(
			// cc classic：`❯` 前缀 + 纯文本回显（Claude Code 语式）；否则气泡原文。
			this.classic ? `❯ ${this.text}` : this.text,
			0,
			0,
			this.markdownTheme,
			{
				color: (content: string) => theme.fg("userMessageText", content),
			},
			{
				preserveOrderedListMarkers: true,
				preserveBackslashEscapes: true,
				transform: createMarkdownTransform("user", false, this.markdownTransformers),
			},
		);
		if (this.classic) {
			// 无气泡、无输出垫：`❯ 消息` 直接落在文档流。
			this.addChild(markdown);
			return;
		}
		// V2：fullscreen 归属标签（`You`，气泡上方一行）。
		if (this.label !== undefined) {
			this.addChild(new Text(theme.fg("dim", this.label), 0, 0));
		}
		const contentBox = new Box(this.outputPad, 1, (content: string) => theme.bg("userMessageBg", content));
		contentBox.addChild(markdown);
		this.addChild(contentBox);
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return this.footerText === undefined ? lines : [...lines, ...this.footerText.render(width)];
	}
}
