import Anthropic from '@anthropic-ai/sdk';

export async function generateMarkdownGuide(topic: string): Promise<{ title: string; content: string }> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Generate a comprehensive markdown guide about: "${topic}"

Requirements:
- Start with a title (# heading)
- Include 3-5 main sections with ## headings
- Add code examples if relevant (use \`\`\` code blocks)
- Include bullet points and numbered lists where appropriate
- Keep it informative but concise (around 500-800 words)
- Make it actually useful and educational

Output ONLY the markdown content, nothing else.`
      }
    ]
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );

  const content = textBlock?.text || `# ${topic}\n\nContent generation failed.`;

  // Extract title from first heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : topic;

  return { title, content };
}
