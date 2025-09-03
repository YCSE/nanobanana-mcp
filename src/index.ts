#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
} from '@google/genai';
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.GOOGLE_AI_API_KEY;

if (!API_KEY) {
  console.error("Error: GOOGLE_AI_API_KEY environment variable is required");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const genAINew = new GoogleGenAI({
  apiKey: API_KEY,
});

interface ConversationContext {
  history: Array<{
    role: "user" | "model";
    parts: Part[];
  }>;
}

const conversations = new Map<string, ConversationContext>();

async function imageToBase64(imagePath: string): Promise<string> {
  const imageBuffer = await fs.readFile(imagePath);
  return imageBuffer.toString("base64");
}


async function saveImageFromBuffer(buffer: Buffer, outputPath: string): Promise<void> {
  // Ensure directory exists
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(outputPath, buffer);
}


const server = new Server(
  {
    name: "nanobanana-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "gemini_chat",
        description: "Chat with Gemini 2.5 Flash model. Supports multi-turn conversations.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The message to send to Gemini",
            },
            conversation_id: {
              type: "string",
              description: "Optional conversation ID for maintaining context",
            },
            system_prompt: {
              type: "string",
              description: "Optional system prompt to guide the model's behavior",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "gemini_vision",
        description: "Analyze images using Gemini's vision capabilities",
        inputSchema: {
          type: "object",
          properties: {
            image_path: {
              type: "string",
              description: "Path to the image file to analyze",
            },
            prompt: {
              type: "string",
              description: "Question or instruction about the image",
            },
            conversation_id: {
              type: "string",
              description: "Optional conversation ID for maintaining context",
            },
          },
          required: ["image_path", "prompt"],
        },
      },
      {
        name: "gemini_generate_image",
        description: "Generate images using Gemini's image generation capabilities",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Description of the image to generate",
            },
            output_path: {
              type: "string",
              description: "Optional path where to save the generated image. If not provided, saves to project assets folder.",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "gemini_edit_image",
        description: "Edit or modify existing images based on prompts",
        inputSchema: {
          type: "object",
          properties: {
            image_path: {
              type: "string",
              description: "Path to the original image",
            },
            edit_prompt: {
              type: "string",
              description: "Instructions for how to edit the image",
            },
            output_path: {
              type: "string",
              description: "Optional output path. If not provided, overwrites the original.",
            },
          },
          required: ["image_path", "edit_prompt"],
        },
      },
      {
        name: "clear_conversation",
        description: "Clear conversation history for a specific conversation ID",
        inputSchema: {
          type: "object",
          properties: {
            conversation_id: {
              type: "string",
              description: "The conversation ID to clear",
            },
          },
          required: ["conversation_id"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "gemini_chat": {
        const { message, conversation_id = "default", system_prompt } = args as any;
        
        if (!conversations.has(conversation_id)) {
          conversations.set(conversation_id, { history: [] });
        }
        
        const context = conversations.get(conversation_id)!;
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.5-flash-image-preview",
          systemInstruction: system_prompt,
        });

        // Add user message to history
        context.history.push({
          role: "user",
          parts: [{ text: message }],
        });

        // Start chat with history
        const chat = model.startChat({
          history: context.history.slice(0, -1), // All except the last message
        });

        const result = await chat.sendMessage(message);
        const response = result.response;
        const text = response.text();

        // Add model response to history
        context.history.push({
          role: "model",
          parts: [{ text }],
        });

        return {
          content: [
            {
              type: "text",
              text: text,
            },
          ],
        };
      }

      case "gemini_vision": {
        const { image_path, prompt, conversation_id = "default" } = args as any;
        
        if (!conversations.has(conversation_id)) {
          conversations.set(conversation_id, { history: [] });
        }
        
        const context = conversations.get(conversation_id)!;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

        // Read and encode image
        const imageBase64 = await imageToBase64(image_path);
        
        // Add to history
        context.history.push({
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        });

        const result = await model.generateContent([
          prompt,
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageBase64,
            },
          },
        ]);

        const response = result.response;
        const text = response.text();

        // Add response to history
        context.history.push({
          role: "model",
          parts: [{ text }],
        });

        return {
          content: [
            {
              type: "text",
              text: text,
            },
          ],
        };
      }

      case "gemini_generate_image": {
        const { 
          prompt, 
          output_path, 
        } = args as any;

        try {
          // Configure model with image generation capabilities
          const config = {
            responseModalities: ['IMAGE', 'TEXT'],
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
            ],
          };

          const model = 'gemini-2.5-flash-image-preview';
          const contents = [
            {
              role: 'user' as const,
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ];

          // Generate image
          const response = await genAINew.models.generateContentStream({
            model,
            config,
            contents,
          });

          // Determine output path - always ensure PNG extension
          let finalPath = output_path;
          if (!finalPath) {
            // Use ~/Documents/nanobanana_generated for generated images
            const homeDir = os.homedir();
            const tempDir = path.join(homeDir, 'Documents', 'nanobanana_generated');
            await fs.mkdir(tempDir, { recursive: true });
            const filename = `generated_${Date.now()}.png`;
            finalPath = path.join(tempDir, filename);
          } else {
            // Handle relative and absolute paths
            if (!path.isAbsolute(finalPath)) {
              finalPath = path.join(process.cwd(), finalPath);
            }
            // Ensure the output path has .png extension
            if (!finalPath.toLowerCase().endsWith('.png')) {
              // Replace any existing extension or add .png
              finalPath = finalPath.replace(/\.[^/.]+$/, '') + '.png';
            }
          }

          let imageGenerated = false;
          let textResponse = '';

          // Process response stream
          for await (const chunk of response) {
            if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
              continue;
            }
            
            if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
              const inlineData = chunk.candidates[0].content.parts[0].inlineData;
              const buffer = Buffer.from(inlineData.data || '', 'base64');
              
              // Save image as PNG
              await saveImageFromBuffer(buffer, finalPath);
              imageGenerated = true;
            } else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
              textResponse += chunk.candidates[0].content.parts[0].text;
            }
          }

          if (imageGenerated) {
            return {
              content: [
                {
                  type: "text",
                  text: `✓ Image generated successfully!\n` +
                        `Prompt: "${prompt}"\n` +
                        `Saved to: ${finalPath}\n` +
                        (textResponse ? `\nModel response: ${textResponse}` : ''),
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Image generation failed.\n` +
                        `Prompt: "${prompt}"\n` +
                        (textResponse ? `Model response: ${textResponse}` : 'No response from model'),
                },
              ],
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error generating image: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }

      case "gemini_edit_image": {
        const { image_path, edit_prompt, output_path } = args as any;
        
        try {
          // Handle relative and absolute paths for input image
          let resolvedImagePath = image_path;
          if (!path.isAbsolute(resolvedImagePath)) {
            resolvedImagePath = path.join(process.cwd(), resolvedImagePath);
          }
          
          // Check if file exists
          try {
            await fs.access(resolvedImagePath);
          } catch {
            // If file doesn't exist in CWD, try in Documents/nanobanana_generated
            const homeDir = os.homedir();
            const altPath = path.join(homeDir, 'Documents', 'nanobanana_generated', path.basename(image_path));
            try {
              await fs.access(altPath);
              resolvedImagePath = altPath;
            } catch {
              throw new Error(`Image file not found: ${image_path}`);
            }
          }
          
          // Read the original image
          const imageBase64 = await imageToBase64(resolvedImagePath);
          
          // Configure model with image generation capabilities
          const config = {
            responseModalities: ['IMAGE', 'TEXT'],
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
            ],
          };

          const model = 'gemini-2.5-flash-image-preview';
          
          // Create a comprehensive prompt that includes the original image and edit instructions
          const editingPrompt = `Based on this image, generate a new edited version with the following modifications: ${edit_prompt}
          
          IMPORTANT: Create a completely new image that incorporates the requested changes while maintaining the style and overall composition of the original.`;
          
          const contents = [
            {
              role: 'user' as const,
              parts: [
                {
                  text: editingPrompt,
                },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: imageBase64,
                  },
                },
              ],
            },
          ];

          // Generate edited image
          const response = await genAINew.models.generateContentStream({
            model,
            config,
            contents,
          });

          // Determine output path - ensure PNG extension for edited images
          let finalPath = output_path;
          if (!finalPath) {
            // If no output path specified, save with _edited suffix
            const origPath = path.parse(image_path);
            const homeDir = os.homedir();
            const tempDir = path.join(homeDir, 'Documents', 'nanobanana_generated');
            await fs.mkdir(tempDir, { recursive: true });
            const filename = `${origPath.name}_edited_${Date.now()}.png`;
            finalPath = path.join(tempDir, filename);
          } else {
            // Handle relative and absolute paths
            if (!path.isAbsolute(finalPath)) {
              finalPath = path.join(process.cwd(), finalPath);
            }
            if (!finalPath.toLowerCase().endsWith('.png')) {
              finalPath = finalPath.replace(/\.[^/.]+$/, '') + '.png';
            }
          }

          let imageGenerated = false;
          let textResponse = '';

          // Process response stream
          for await (const chunk of response) {
            if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
              continue;
            }
            
            if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
              const inlineData = chunk.candidates[0].content.parts[0].inlineData;
              const buffer = Buffer.from(inlineData.data || '', 'base64');
              
              // Save edited image as PNG
              await saveImageFromBuffer(buffer, finalPath);
              imageGenerated = true;
            } else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
              textResponse += chunk.candidates[0].content.parts[0].text;
            }
          }

          if (imageGenerated) {
            return {
              content: [
                {
                  type: "text",
                  text: `✓ Image edited successfully!\n` +
                        `Original: ${resolvedImagePath}\n` +
                        `Edit request: "${edit_prompt}"\n` +
                        `Saved to: ${finalPath}\n` +
                        (textResponse ? `\nModel response: ${textResponse}` : ''),
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Image editing failed.\n` +
                        `Original: ${image_path}\n` +
                        `Edit request: "${edit_prompt}"\n` +
                        (textResponse ? `Model response: ${textResponse}` : 'No response from model'),
                },
              ],
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error editing image: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }

      case "clear_conversation": {
        const { conversation_id } = args as any;
        conversations.delete(conversation_id);
        
        return {
          content: [
            {
              type: "text",
              text: `Conversation history cleared for ID: ${conversation_id}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gemini MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});