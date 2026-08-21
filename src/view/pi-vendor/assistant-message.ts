import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Container, Markdown, type MarkdownTheme, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "./extensions-types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private isStreaming = false;
	/**
	 * Message-level thinking expansion: when set, THIS message shows its
	 * thinking blocks even while the global Ctrl+T hide is on. The global
	 * toggle still wins when it shows everything. Toggled from the keyboard
	 * (Enter on the focused message), pi-style — no mouse listening.
	 */
	private thinkingExpanded = false;
	/**
	 * cc 语式（Claude Code 对齐）：思考结束后本消息的 thinking 自动收起成
	 * 一行「Thinking…」，Enter 展开。与全局 Ctrl+T（hideThinkingBlock）
	 * 正交：两者任一为真且未展开时即折叠；app 在流式结束/预设切换时设置。
	 */
	private autoCollapseThinking = false;
	private hasThinking = false;
	/** V2: fullscreen 消息归属标签（`Claude`，内容上方一行）。 */
	private label?: string;
	/** Optional one-line footer under the message (T1② stats). */
	private footerText?: Text;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		label?: string,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.label = label;

		// Container for text/thinking content
		this.contentContainer = new Container();
		// V2：fullscreen 归属标签（`Claude`，内容上方一行）——先加标签再挂内容，保证标签在上。
		if (this.label !== undefined) {
			this.addChild(new Text(theme.fg("dim", this.label), 0, 0));
		}
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	/** cc 语式：思考结束后自动收起（streaming 时传 false 保持展开）。 */
	setAutoCollapseThinking(collapse: boolean): void {
		if (this.autoCollapseThinking === collapse) return;
		this.autoCollapseThinking = collapse;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	/** 是否处于折叠态（全局 Ctrl+T 或 cc 自动收起，且本消息未手动展开）。 */
	private isThinkingCollapsed(): boolean {
		return (this.hideThinkingBlock || this.autoCollapseThinking) && !this.thinkingExpanded;
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	/** Whether thinking blocks exist and are currently hidden. */
	hasHiddenThinking(): boolean {
		return this.hasThinking && this.isThinkingCollapsed();
	}

	/** Whether THIS message's thinking was expanded (round-trip). */
	isThinkingExpanded(): boolean {
		return this.thinkingExpanded;
	}

	/** Toggle this message's thinking blocks (Enter on the focused message). */
	toggleThinkingExpanded(): void {
		this.thinkingExpanded = !this.thinkingExpanded;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	/** Set (or clear) the one-line footer rendered under the message (T1② stats). */
	setFooter(text: string | undefined): void {
		this.footerText = text === undefined ? undefined : new Text(text, 0, 0);
		this.invalidate();
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		// Thinking state icon at the end of the first row (▸ hidden / ▾
		// expanded): a pure status marker — the toggle is the keyboard
		// (Enter on the focused message).
		if (this.hasThinking && lines.length > 0) {
			const icon = this.isThinkingCollapsed() ? '▸' : '▾';
			lines[0] = `${truncateToWidth(lines[0], Math.max(1, width - 2))}${theme.fg('thinkingText', icon)}`;
		}
		if (this.hasToolCalls || lines.length === 0) {
			return this.footerText === undefined ? lines : [...lines, ...this.footerText.render(width)];
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return this.footerText === undefined ? lines : [...lines, ...this.footerText.render(width)];
	}

	updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
		this.lastMessage = message;
		this.isStreaming = isStreaming;
		this.hasThinking = false;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(
					new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme, undefined, {
						transform: createMarkdownTransform("assistant", this.isStreaming, this.markdownTransformers),
					}),
				);
			} else if (content.type === "thinking") {
				const thinkingBlocks: string[] = [];
				for (; i < message.content.length; i++) {
					const thinkingContent = message.content[i];
					if (thinkingContent.type !== "thinking") {
						break;
					}
					const thinking = thinkingContent.thinking.trim();
					if (thinking) {
						thinkingBlocks.push(thinking);
					}
				}
				i--;

				if (thinkingBlocks.length === 0) {
					continue;
				}
				this.hasThinking = true;

				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				if (this.isThinkingCollapsed()) {
					// Show one static label for each run of thinking blocks when hidden.
					this.contentContainer.addChild(
						new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), this.outputPad, 0),
					);
				} else {
					// Render each thinking block with a descending intensity
					// grade (T5④: L1 → L2 → L3, pi's graded reasoning look).
					thinkingBlocks.forEach((block, index) => {
						const level = index === 0 ? "thinkingL1" : index === 1 ? "thinkingL2" : "thinkingL3";
						this.contentContainer.addChild(
							new Markdown(
								block,
								this.outputPad,
								0,
								this.markdownTheme,
								{
									color: (text: string) => theme.fg(level, text),
									italic: true,
								},
								{
									transform: createMarkdownTransform(
										"assistant-thinking",
										this.isStreaming,
										this.markdownTransformers,
									),
								},
							),
						);
					});
				}
				if (hasVisibleContentAfter) {
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		// Check if incomplete/failed - show after partial content.
		// For aborted/error tool calls, tool execution components show the error.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("error", "Response was truncated before completion."), this.outputPad, 0),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}
