"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children, inline = false }: { children: string; inline?: boolean }) {
  return (
    <div className={`md${inline ? " md-inline" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
