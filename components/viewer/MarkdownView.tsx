"use client";
import { useMemo } from "react";
import { marked } from "marked";
import { sanitizeHtml } from "./lib";

/** GitHub-flavoured Markdown (tables, task lists, fenced code) → sanitised HTML. */
export default function MarkdownView({ text }: { text: string }) {
  const html = useMemo(() => sanitizeHtml(marked.parse(text, { gfm: true, async: false }) as string), [text]);
  return <article className="md-body p-5 sm:p-8 max-w-3xl mx-auto" dangerouslySetInnerHTML={{ __html: html }} />;
}
