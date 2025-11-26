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

// 이미지 히스토리 엔트리 - 세션 내 이미지 일관성 유지용
interface ImageHistoryEntry {
  id: string;
  filePath: string;
  base64Data: string;
  mimeType: string;
  prompt: string;
  timestamp: number;
  type: "generated" | "edited";
}

interface ConversationContext {
  history: Array<{
    role: "user" | "model";
    parts: Part[];
  }>;
  imageHistory: ImageHistoryEntry[];
}

const conversations = new Map<string, ConversationContext>();

// 이미지 히스토리 최대 개수 (메모리 관리)
const MAX_IMAGE_HISTORY = 10;
// API 요청 시 포함할 최근 이미지 개수
const MAX_REFERENCE_IMAGES = 3;

// 고유 이미지 ID 생성
function generateImageId(): string {
  return `img_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// 이미지를 히스토리에 추가
function addImageToHistory(
  context: ConversationContext,
  entry: ImageHistoryEntry
): void {
  context.imageHistory.push(entry);
  // 최대 개수 초과 시 오래된 것 제거
  if (context.imageHistory.length > MAX_IMAGE_HISTORY) {
    context.imageHistory.shift();
  }
}

// 히스토리에서 이미지 참조 가져오기 ("last", "history:0" 등)
function getImageFromHistory(
  context: ConversationContext,
  reference: string
): ImageHistoryEntry | null {
  if (!context.imageHistory?.length) return null;

  if (reference === 'last') {
    return context.imageHistory[context.imageHistory.length - 1];
  }

  const match = reference.match(/^history:(\d+)$/);
  if (match) {
    const index = parseInt(match[1], 10);
    return context.imageHistory[index] ?? null;
  }

  return null;
}

// 대화 컨텍스트 초기화/가져오기
function getOrCreateContext(conversationId: string): ConversationContext {
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, { history: [], imageHistory: [] });
  }
  return conversations.get(conversationId)!;
}

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
        description: "Generate images using Gemini's image generation capabilities. Supports session-based image consistency for maintaining style/character across multiple generations.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Description of the image to generate",
            },
            output_path: {
              type: "string",
              description: "Optional path where to save the generated image. If not provided, saves to ~/Documents/nanobanana_generated/",
            },
            conversation_id: {
              type: "string",
              description: "Session ID for maintaining image history and consistency across generations",
            },
            use_image_history: {
              type: "boolean",
              description: "If true, includes previous generated images from this session for style/character consistency",
            },
            reference_images: {
              type: "array",
              items: { type: "string" },
              description: "Array of file paths to reference images for style/character consistency",
            },
            enable_google_search: {
              type: "boolean",
              description: "Enable Google Search for real-world reference grounding",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "gemini_edit_image",
        description: "Edit or modify existing images based on prompts. Supports session history references ('last' or 'history:N') and image consistency features.",
        inputSchema: {
          type: "object",
          properties: {
            image_path: {
              type: "string",
              description: "Path to the original image. Use 'last' for most recent generated image, or 'history:N' (e.g., 'history:0') to reference by index",
            },
            edit_prompt: {
              type: "string",
              description: "Instructions for how to edit the image",
            },
            output_path: {
              type: "string",
              description: "Optional output path. If not provided, saves to ~/Documents/nanobanana_generated/",
            },
            conversation_id: {
              type: "string",
              description: "Session ID for accessing image history and maintaining consistency",
            },
            reference_images: {
              type: "array",
              items: { type: "string" },
              description: "Additional reference images for style consistency during editing",
            },
            enable_google_search: {
              type: "boolean",
              description: "Enable Google Search for real-world reference grounding",
            },
          },
          required: ["image_path", "edit_prompt"],
        },
      },
      {
        name: "get_image_history",
        description: "Get the list of generated/edited images in a session for reference",
        inputSchema: {
          type: "object",
          properties: {
            conversation_id: {
              type: "string",
              description: "The session ID to get image history for",
            },
          },
          required: ["conversation_id"],
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

        const context = getOrCreateContext(conversation_id);
        const model = genAI.getGenerativeModel({ 
          model: "gemini-2.5-flash-image",
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

        const context = getOrCreateContext(conversation_id);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });

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
          conversation_id = "default",
          use_image_history = false,
          reference_images = [],
          enable_google_search = false,
        } = args as any;

        try {
          // 대화 컨텍스트 가져오기/생성
          const context = getOrCreateContext(conversation_id);

          // Configure model with image generation capabilities
          const config: Record<string, unknown> = {
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

          // 이미지 크기 2K 고정
          config.imageConfig = { imageSize: "2K" };

          const model = 'gemini-2.5-flash-image';

          // contents 구성: 참조 이미지 + 히스토리 이미지 + 프롬프트
          const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

          // 1. 수동 지정 참조 이미지 추가
          if (reference_images && reference_images.length > 0) {
            for (const imgPath of reference_images) {
              try {
                let resolvedPath = imgPath;
                if (!path.isAbsolute(resolvedPath)) {
                  resolvedPath = path.join(process.cwd(), resolvedPath);
                }
                const base64 = await imageToBase64(resolvedPath);
                parts.push({
                  inlineData: {
                    mimeType: "image/png",
                    data: base64,
                  },
                });
              } catch {
                // 참조 이미지 로드 실패 시 건너뛰기
              }
            }
          }

          // 2. 히스토리 이미지 추가 (일관성 유지용)
          if (use_image_history && context.imageHistory.length > 0) {
            const recentImages = context.imageHistory.slice(-MAX_REFERENCE_IMAGES);
            for (const img of recentImages) {
              parts.push({
                inlineData: {
                  mimeType: img.mimeType,
                  data: img.base64Data,
                },
              });
            }
          }

          // 3. 프롬프트 추가 (히스토리 이미지가 있으면 일관성 유지 지시 추가)
          let finalPrompt = prompt;
          if (use_image_history && context.imageHistory.length > 0) {
            finalPrompt = `${prompt}\n\nIMPORTANT: Maintain visual consistency with the provided reference images (same style, character appearance, color palette).`;
          }
          parts.push({ text: finalPrompt });

          const contents = [
            {
              role: 'user' as const,
              parts,
            },
          ];

          // Google Search 도구 (조건부)
          const tools = enable_google_search ? [{ googleSearch: {} }] : undefined;

          // Generate image
          const response = await genAINew.models.generateContentStream({
            model,
            config,
            contents,
            ...(tools && { tools }),
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
          let generatedImageBase64 = '';

          // Process response stream
          for await (const chunk of response) {
            if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
              continue;
            }

            if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
              const inlineData = chunk.candidates[0].content.parts[0].inlineData;
              generatedImageBase64 = inlineData.data || '';
              const buffer = Buffer.from(generatedImageBase64, 'base64');

              // Save image as PNG
              await saveImageFromBuffer(buffer, finalPath);
              imageGenerated = true;
            } else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
              textResponse += chunk.candidates[0].content.parts[0].text;
            }
          }

          if (imageGenerated) {
            // 생성된 이미지를 히스토리에 저장
            addImageToHistory(context, {
              id: generateImageId(),
              filePath: finalPath,
              base64Data: generatedImageBase64,
              mimeType: "image/png",
              prompt: prompt,
              timestamp: Date.now(),
              type: "generated",
            });

            return {
              content: [
                {
                  type: "text",
                  text: `✓ Image generated successfully!\n` +
                        `Prompt: "${prompt}"\n` +
                        `Saved to: ${finalPath}\n` +
                        `Session: ${conversation_id} (history: ${context.imageHistory.length} images)\n` +
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
        const {
          image_path,
          edit_prompt,
          output_path,
          conversation_id = "default",
          reference_images = [],
          enable_google_search = false,
        } = args as any;

        try {
          // 대화 컨텍스트 가져오기/생성
          const context = getOrCreateContext(conversation_id);

          // 히스토리 참조 확인 ("last", "history:N")
          let resolvedImagePath = image_path;
          let imageBase64: string;

          const historyImage = getImageFromHistory(context, image_path);
          if (historyImage) {
            // 히스토리에서 이미지 가져오기
            resolvedImagePath = historyImage.filePath;
            imageBase64 = historyImage.base64Data;
          } else {
            // 파일 경로로 처리
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
                throw new Error(`Image file not found: ${image_path}. Use 'last' or 'history:N' to reference session images.`);
              }
            }

            // Read the original image
            imageBase64 = await imageToBase64(resolvedImagePath);
          }

          // Configure model with image generation capabilities
          const config: Record<string, unknown> = {
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

          // 이미지 크기 2K 고정
          config.imageConfig = { imageSize: "2K" };

          const model = 'gemini-2.5-flash-image';

          // contents 구성: 참조 이미지들 + 원본 이미지 + 프롬프트
          const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

          // 1. 추가 참조 이미지 (스타일 일관성용)
          if (reference_images && reference_images.length > 0) {
            for (const imgPath of reference_images) {
              try {
                let refPath = imgPath;
                if (!path.isAbsolute(refPath)) {
                  refPath = path.join(process.cwd(), refPath);
                }
                const refBase64 = await imageToBase64(refPath);
                parts.push({
                  inlineData: {
                    mimeType: "image/png",
                    data: refBase64,
                  },
                });
              } catch {
                // 참조 이미지 로드 실패 시 건너뛰기
              }
            }
          }

          // 2. 편집 프롬프트
          const editingPrompt = `Based on this image, generate a new edited version with the following modifications: ${edit_prompt}

IMPORTANT: Create a completely new image that incorporates the requested changes while maintaining the style and overall composition of the original.`;
          parts.push({ text: editingPrompt });

          // 3. 원본 이미지
          parts.push({
            inlineData: {
              mimeType: "image/png",
              data: imageBase64,
            },
          });

          const contents = [
            {
              role: 'user' as const,
              parts,
            },
          ];

          // Google Search 도구 (조건부)
          const tools = enable_google_search ? [{ googleSearch: {} }] : undefined;

          // Generate edited image
          const response = await genAINew.models.generateContentStream({
            model,
            config,
            contents,
            ...(tools && { tools }),
          });

          // Determine output path - ensure PNG extension for edited images
          let finalPath = output_path;
          if (!finalPath) {
            // If no output path specified, save with _edited suffix
            const origName = historyImage ? `history_${historyImage.id}` : path.parse(image_path).name;
            const homeDir = os.homedir();
            const tempDir = path.join(homeDir, 'Documents', 'nanobanana_generated');
            await fs.mkdir(tempDir, { recursive: true });
            const filename = `${origName}_edited_${Date.now()}.png`;
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
          let editedImageBase64 = '';

          // Process response stream
          for await (const chunk of response) {
            if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
              continue;
            }

            if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
              const inlineData = chunk.candidates[0].content.parts[0].inlineData;
              editedImageBase64 = inlineData.data || '';
              const buffer = Buffer.from(editedImageBase64, 'base64');

              // Save edited image as PNG
              await saveImageFromBuffer(buffer, finalPath);
              imageGenerated = true;
            } else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
              textResponse += chunk.candidates[0].content.parts[0].text;
            }
          }

          if (imageGenerated) {
            // 편집된 이미지를 히스토리에 저장
            addImageToHistory(context, {
              id: generateImageId(),
              filePath: finalPath,
              base64Data: editedImageBase64,
              mimeType: "image/png",
              prompt: edit_prompt,
              timestamp: Date.now(),
              type: "edited",
            });

            return {
              content: [
                {
                  type: "text",
                  text: `✓ Image edited successfully!\n` +
                        `Original: ${historyImage ? `[${image_path}] ${resolvedImagePath}` : resolvedImagePath}\n` +
                        `Edit request: "${edit_prompt}"\n` +
                        `Saved to: ${finalPath}\n` +
                        `Session: ${conversation_id} (history: ${context.imageHistory.length} images)\n` +
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

      case "get_image_history": {
        const { conversation_id } = args as any;

        const context = conversations.get(conversation_id);
        if (!context || !context.imageHistory?.length) {
          return {
            content: [
              {
                type: "text",
                text: `No image history found for session: ${conversation_id}`,
              },
            ],
          };
        }

        const historyInfo = context.imageHistory.map((img, index) => ({
          index,
          reference: `history:${index}`,
          id: img.id,
          filePath: img.filePath,
          prompt: img.prompt,
          type: img.type,
          timestamp: new Date(img.timestamp).toISOString(),
        }));

        return {
          content: [
            {
              type: "text",
              text: `Image History for session "${conversation_id}" (${context.imageHistory.length} images):\n\n` +
                    `Use "last" to reference the most recent image, or "history:N" (e.g., "history:0") to reference by index.\n\n` +
                    JSON.stringify(historyInfo, null, 2),
            },
          ],
        };
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