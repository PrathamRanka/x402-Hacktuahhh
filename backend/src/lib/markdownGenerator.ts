import { GoogleGenerativeAI } from '@google/generative-ai';

// Use same base model as negotiation layer
const GEMINI_MODEL = 'models/gemini-2.5-flash-lite';

export async function generateMarkdownGuide(topic: string): Promise<{ title: string; content: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set.');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  try {
    const prompt = `Generate a comprehensive markdown guide about: "${topic}"

Requirements:
- Start with a title (# heading)
- Include 3-5 main sections with ## headings
- Add code examples if relevant (use \`\`\` code blocks)
- Include bullet points and numbered lists where appropriate
- Keep it informative but concise (around 500-800 words)
- Make it actually useful and educational

Output ONLY the markdown content, nothing else.`;

    const result = await model.generateContent(prompt);
    let content = result.response.text();
    
    // Clean up markdown block wrapping if Gemini decides to include it
    if (content.startsWith('\`\`\`markdown')) {
      content = content.replace(/^\`\`\`markdown\n?/, '').replace(/\`\`\`\n?$/, '').trim();
    } else if (content.startsWith('\`\`\`')) {
      content = content.replace(/^\`\`\`\n?/, '').replace(/\`\`\`\n?$/, '').trim();
    }

    // Extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : topic;

    return { title, content };
  } catch (error) {
    console.error('Failed to generate markdown guide with Gemini:', error);
    return { title: topic, content: `# ${topic}\n\nContent generation failed.` };
  }
}
