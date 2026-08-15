import type { MarkdownTransformContext, MarkdownTransformer } from "./extensions-types.ts";

export function createMarkdownTransform(
	messageType: MarkdownTransformContext["messageType"],
	isStreaming: boolean,
	transformers: readonly MarkdownTransformer[],
): (markdown: string, availableWidth: number) => string {
	return (markdown, availableWidth) =>
		applyMarkdownTransformers(markdown, { messageType, isStreaming, availableWidth }, transformers);
}

function applyMarkdownTransformers(
	markdown: string,
	context: MarkdownTransformContext,
	transformers: readonly MarkdownTransformer[],
): string {
	let transformedMarkdown = markdown;
	for (const transformer of transformers) {
		try {
			const transformed = transformer(transformedMarkdown, context);
			if (typeof transformed === "string") {
				transformedMarkdown = transformed;
			}
		} catch {
			// Keep the current Markdown and continue with the next transformer.
		}
	}
	return transformedMarkdown;
}

/** Prepend a dim blockquote label naming each fenced code block's language. */
export function codeLabelTransformer(markdown: string): string {
  return markdown.replace(/^```(\w*)[ \t]*$/gm, (match, lang: string) => {
    if (lang === '') return match
    return '> ' + lang + '\n' + match
  })
}
