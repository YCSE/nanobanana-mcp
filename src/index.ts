#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenerativeAI, Part } from "@google/generative-ai";
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

// Gemini REST API 직접 호출을 위한 설정
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const IMAGE_MODEL = "gemini-2.5-flash-image";

// 이미지 생성/편집을 위한 REST API 호출 함수
interface GeminiImageRequestPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiImageResponse {
  imageData?: string;
  textResponse: string;
  error?: string;
}

async function callGeminiImageAPI(
  parts: GeminiImageRequestPart[],
  aspectRatio: string
): Promise<GeminiImageResponse> {
  const url = `${GEMINI_API_BASE}/${IMAGE_MODEL}:streamGenerateContent?key=${API_KEY}`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
      imageConfig: {
        aspectRatio,
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  const responseText = await response.text();

  // 스트리밍 응답 파싱 (여러 JSON 청크가 배열로 반환됨)
  let imageData: string | undefined;
  let textParts: string[] = [];

  try {
    // 응답이 JSON 배열 형태로 옴
    const chunks = JSON.parse(responseText);

    for (const chunk of chunks) {
      const parts = chunk?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          imageData = part.inlineData.data;
        } else if (part.text) {
          textParts.push(part.text);
        }
      }
    }
  } catch {
    // 파싱 실패 시 원본 텍스트 반환
    return {
      textResponse: responseText,
      error: "Failed to parse API response",
    };
  }

  return {
    imageData,
    textResponse: textParts.join(""),
  };
}

// 유효한 이미지 비율 목록
const VALID_ASPECT_RATIOS = [
  "1:1", "9:16", "16:9", "3:4", "4:3",
  "3:2", "2:3", "5:4", "4:5", "21:9"
] as const;
type AspectRatio = typeof VALID_ASPECT_RATIOS[number];

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
  aspectRatio: AspectRatio | null;
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
    conversations.set(conversationId, {
      history: [],
      imageHistory: [],
      aspectRatio: null,  // Must be set via set_aspect_ratio before image generation
    });
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
        description: "Chat with Gemini 2.5 Flash model. Supports multi-turn conversations with up to 10 reference images.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The message to send to Gemini",
            },
            images: {
              type: "array",
              items: { type: "string" },
              description: "Array of image paths to include in the chat (max 10). Supports file paths, 'last', or 'history:N' references.",
              maxItems: 10,
            },
            conversation_id: {
              type: "string",
              description: "Optional conversation ID for maintaining context and accessing image history",
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
        name: "gemini_generate_image",
        description: "Generate images using Gemini's image generation capabilities. Supports session-based image consistency for maintaining style/character across multiple generations.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Description of the image to generate",
            },
            aspect_ratio: {
              type: "string",
              enum: [...VALID_ASPECT_RATIOS],
              description: "Aspect ratio for the generated image. Overrides session setting if provided.",
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
            aspect_ratio: {
              type: "string",
              enum: [...VALID_ASPECT_RATIOS],
              description: "Aspect ratio for the edited image. Overrides session setting if provided.",
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
              description: "Additional reference images for style consistency (max 10). Supports file paths, 'last', or 'history:N' references.",
              maxItems: 10,
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
      {
        name: "set_aspect_ratio",
        description: "Set the aspect ratio for subsequent image generation and editing in this session. Must be called before generating/editing images if a specific ratio is desired.",
        inputSchema: {
          type: "object",
          properties: {
            aspect_ratio: {
              type: "string",
              enum: [...VALID_ASPECT_RATIOS],
              description: "The aspect ratio to use for image generation/editing",
            },
            conversation_id: {
              type: "string",
              description: "Session ID to apply this setting to (default: 'default')",
            },
          },
          required: ["aspect_ratio"],
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
        const { message, conversation_id = "default", system_prompt, images = [] } = args as any;

        const context = getOrCreateContext(conversation_id);
        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash-image",
          systemInstruction: system_prompt,
        });

        // Build message parts with images (max 10)
        const messageParts: Part[] = [{ text: message }];
        const imageRefs = (images as string[]).slice(0, 10);
        const failedImages: Array<{ path: string; reason: string }> = [];

        for (const imgRef of imageRefs) {
          try {
            // Check for history reference
            const historyImage = getImageFromHistory(context, imgRef);
            if (historyImage) {
              messageParts.push({
                inlineData: {
                  mimeType: historyImage.mimeType,
                  data: historyImage.base64Data,
                },
              });
            } else {
              // File path
              let resolvedPath = imgRef;
              if (!path.isAbsolute(resolvedPath)) {
                resolvedPath = path.join(process.cwd(), resolvedPath);
              }
              // Try alternative path if not found
              try {
                await fs.access(resolvedPath);
              } catch {
                const homeDir = os.homedir();
                const altPath = path.join(homeDir, 'Documents', 'nanobanana_generated', path.basename(imgRef));
                await fs.access(altPath);
                resolvedPath = altPath;
              }
              const base64 = await imageToBase64(resolvedPath);
              messageParts.push({
                inlineData: {
                  mimeType: "image/png",
                  data: base64,
                },
              });
            }
          } catch (error) {
            failedImages.push({
              path: imgRef,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Add user message to history
        context.history.push({
          role: "user",
          parts: messageParts,
        });

        // Start chat with history
        const chat = model.startChat({
          history: context.history.slice(0, -1), // All except the last message
        });

        const result = await chat.sendMessage(messageParts);
        const response = result.response;
        const text = response.text();

        // Add model response to history
        context.history.push({
          role: "model",
          parts: [{ text }],
        });

        const imageCount = messageParts.length - 1;
        let responseText = imageCount > 0
          ? `[${imageCount} image(s) included]\n\n${text}`
          : text;

        if (failedImages.length > 0) {
          responseText += `\n\nWarning: ${failedImages.length} image(s) could not be loaded:\n`;
          responseText += failedImages.map(f => `  - ${f.path}: ${f.reason}`).join('\n');
        }

        return {
          content: [{ type: "text", text: responseText }],
        };
      }

      case "gemini_generate_image": {
        const {
          prompt,
          aspect_ratio,
          output_path,
          conversation_id = "default",
          use_image_history = false,
          reference_images = [],
        } = args as any;

        try {
          // 대화 컨텍스트 가져오기/생성
          const context = getOrCreateContext(conversation_id);

          // Validate directly passed aspect_ratio
          if (aspect_ratio && !VALID_ASPECT_RATIOS.includes(aspect_ratio as AspectRatio)) {
            return {
              content: [{
                type: "text",
                text: `Invalid aspect ratio: ${aspect_ratio}. Valid: ${VALID_ASPECT_RATIOS.join(", ")}`,
              }],
              isError: true,
            };
          }

          // Priority: direct param > session setting
          const effectiveAspectRatio = aspect_ratio ?? context.aspectRatio;

          // aspectRatio 필수 체크 (둘 다 없으면 에러)
          if (effectiveAspectRatio === null) {
            return {
              content: [{
                type: "text",
                text: `Error: Aspect ratio not specified. Either pass aspect_ratio parameter or call set_aspect_ratio first.\nValid ratios: ${VALID_ASPECT_RATIOS.join(", ")}`,
              }],
              isError: true,
            };
          }

          // contents 구성: 참조 이미지 + 히스토리 이미지 + 프롬프트
          const parts: GeminiImageRequestPart[] = [];
          const failedReferenceImages: Array<{ path: string; reason: string }> = [];

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
              } catch (error) {
                failedReferenceImages.push({
                  path: imgPath,
                  reason: error instanceof Error ? error.message : String(error),
                });
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

          // REST API 직접 호출
          const apiResponse = await callGeminiImageAPI(parts, effectiveAspectRatio);

          if (apiResponse.error) {
            return {
              content: [{
                type: "text",
                text: `Image generation failed: ${apiResponse.error}\n${apiResponse.textResponse}`,
              }],
              isError: true,
            };
          }

          if (!apiResponse.imageData) {
            return {
              content: [{
                type: "text",
                text: `Image generation failed.\nPrompt: "${prompt}"\n` +
                      (apiResponse.textResponse ? `Model response: ${apiResponse.textResponse}` : 'No image returned from model'),
              }],
              isError: true,
            };
          }

          // Determine output path - always ensure PNG extension
          let finalPath = output_path;
          if (!finalPath) {
            const homeDir = os.homedir();
            const tempDir = path.join(homeDir, 'Documents', 'nanobanana_generated');
            await fs.mkdir(tempDir, { recursive: true });
            const filename = `generated_${Date.now()}.png`;
            finalPath = path.join(tempDir, filename);
          } else {
            if (!path.isAbsolute(finalPath)) {
              finalPath = path.join(process.cwd(), finalPath);
            }
            if (!finalPath.toLowerCase().endsWith('.png')) {
              finalPath = finalPath.replace(/\.[^/.]+$/, '') + '.png';
            }
          }

          // Save image
          const buffer = Buffer.from(apiResponse.imageData, 'base64');
          await saveImageFromBuffer(buffer, finalPath);

          // 생성된 이미지를 히스토리에 저장
          addImageToHistory(context, {
            id: generateImageId(),
            filePath: finalPath,
            base64Data: apiResponse.imageData,
            mimeType: "image/png",
            prompt: prompt,
            timestamp: Date.now(),
            type: "generated",
          });

          let successText = `Image generated successfully!\n` +
                `Prompt: "${prompt}"\n` +
                `Saved to: ${finalPath}\n` +
                `Session: ${conversation_id} (history: ${context.imageHistory.length} images)`;

          if (failedReferenceImages.length > 0) {
            successText += `\n\nWarning: ${failedReferenceImages.length} reference image(s) could not be loaded:\n`;
            successText += failedReferenceImages.map(f => `  - ${f.path}: ${f.reason}`).join('\n');
          }

          if (apiResponse.textResponse) {
            successText += `\n\nModel response: ${apiResponse.textResponse}`;
          }

          return {
            content: [{ type: "text", text: successText }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error generating image: ${error instanceof Error ? error.message : String(error)}`,
            }],
          };
        }
      }

      case "gemini_edit_image": {
        const {
          image_path,
          edit_prompt,
          aspect_ratio,
          output_path,
          conversation_id = "default",
          reference_images = [],
        } = args as any;

        try {
          // 대화 컨텍스트 가져오기/생성
          const context = getOrCreateContext(conversation_id);

          // Validate directly passed aspect_ratio
          if (aspect_ratio && !VALID_ASPECT_RATIOS.includes(aspect_ratio as AspectRatio)) {
            return {
              content: [{
                type: "text",
                text: `Invalid aspect ratio: ${aspect_ratio}. Valid: ${VALID_ASPECT_RATIOS.join(", ")}`,
              }],
              isError: true,
            };
          }

          // Priority: direct param > session setting
          const effectiveAspectRatio = aspect_ratio ?? context.aspectRatio;

          // aspectRatio 필수 체크 (둘 다 없으면 에러)
          if (effectiveAspectRatio === null) {
            return {
              content: [{
                type: "text",
                text: `Error: Aspect ratio not specified. Either pass aspect_ratio parameter or call set_aspect_ratio first.\nValid ratios: ${VALID_ASPECT_RATIOS.join(", ")}`,
              }],
              isError: true,
            };
          }

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

          // contents 구성: 참조 이미지들 + 프롬프트 + 원본 이미지
          const parts: GeminiImageRequestPart[] = [];
          const failedReferenceImages: Array<{ path: string; reason: string }> = [];

          // 1. 추가 참조 이미지 (스타일 일관성용, 최대 10개)
          const refImages = (reference_images as string[] || []).slice(0, 10);
          for (const imgRef of refImages) {
            try {
              // Check for history reference
              const refHistoryImage = getImageFromHistory(context, imgRef);
              if (refHistoryImage) {
                parts.push({
                  inlineData: {
                    mimeType: refHistoryImage.mimeType,
                    data: refHistoryImage.base64Data,
                  },
                });
              } else {
                // File path
                let refPath = imgRef;
                if (!path.isAbsolute(refPath)) {
                  refPath = path.join(process.cwd(), refPath);
                }
                // Try alternative path if not found
                try {
                  await fs.access(refPath);
                } catch {
                  const homeDir = os.homedir();
                  const altPath = path.join(homeDir, 'Documents', 'nanobanana_generated', path.basename(imgRef));
                  await fs.access(altPath);
                  refPath = altPath;
                }
                const refBase64 = await imageToBase64(refPath);
                parts.push({
                  inlineData: {
                    mimeType: "image/png",
                    data: refBase64,
                  },
                });
              }
            } catch (error) {
              failedReferenceImages.push({
                path: imgRef,
                reason: error instanceof Error ? error.message : String(error),
              });
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

          // REST API 직접 호출
          const apiResponse = await callGeminiImageAPI(parts, effectiveAspectRatio);

          if (apiResponse.error) {
            return {
              content: [{
                type: "text",
                text: `Image editing failed: ${apiResponse.error}\n${apiResponse.textResponse}`,
              }],
              isError: true,
            };
          }

          if (!apiResponse.imageData) {
            return {
              content: [{
                type: "text",
                text: `Image editing failed.\nOriginal: ${image_path}\nEdit request: "${edit_prompt}"\n` +
                      (apiResponse.textResponse ? `Model response: ${apiResponse.textResponse}` : 'No image returned from model'),
              }],
              isError: true,
            };
          }

          // Determine output path - ensure PNG extension for edited images
          let finalPath = output_path;
          if (!finalPath) {
            const origName = historyImage ? `history_${historyImage.id}` : path.parse(image_path).name;
            const homeDir = os.homedir();
            const tempDir = path.join(homeDir, 'Documents', 'nanobanana_generated');
            await fs.mkdir(tempDir, { recursive: true });
            const filename = `${origName}_edited_${Date.now()}.png`;
            finalPath = path.join(tempDir, filename);
          } else {
            if (!path.isAbsolute(finalPath)) {
              finalPath = path.join(process.cwd(), finalPath);
            }
            if (!finalPath.toLowerCase().endsWith('.png')) {
              finalPath = finalPath.replace(/\.[^/.]+$/, '') + '.png';
            }
          }

          // Save image
          const buffer = Buffer.from(apiResponse.imageData, 'base64');
          await saveImageFromBuffer(buffer, finalPath);

          // 편집된 이미지를 히스토리에 저장
          addImageToHistory(context, {
            id: generateImageId(),
            filePath: finalPath,
            base64Data: apiResponse.imageData,
            mimeType: "image/png",
            prompt: edit_prompt,
            timestamp: Date.now(),
            type: "edited",
          });

          let successText = `Image edited successfully!\n` +
                `Original: ${historyImage ? `[${image_path}] ${resolvedImagePath}` : resolvedImagePath}\n` +
                `Edit request: "${edit_prompt}"\n` +
                `Saved to: ${finalPath}\n` +
                `Session: ${conversation_id} (history: ${context.imageHistory.length} images)`;

          if (failedReferenceImages.length > 0) {
            successText += `\n\nWarning: ${failedReferenceImages.length} reference image(s) could not be loaded:\n`;
            successText += failedReferenceImages.map(f => `  - ${f.path}: ${f.reason}`).join('\n');
          }

          if (apiResponse.textResponse) {
            successText += `\n\nModel response: ${apiResponse.textResponse}`;
          }

          return {
            content: [{ type: "text", text: successText }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error editing image: ${error instanceof Error ? error.message : String(error)}`,
            }],
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

      case "set_aspect_ratio": {
        const { aspect_ratio, conversation_id = "default" } = args as any;

        // Validate aspect ratio
        if (!VALID_ASPECT_RATIOS.includes(aspect_ratio as AspectRatio)) {
          return {
            content: [{
              type: "text",
              text: `Invalid aspect ratio: ${aspect_ratio}. Valid: ${VALID_ASPECT_RATIOS.join(", ")}`,
            }],
            isError: true,
          };
        }

        const context = getOrCreateContext(conversation_id);
        context.aspectRatio = aspect_ratio as AspectRatio;

        return {
          content: [{
            type: "text",
            text: `✓ Aspect ratio set to ${aspect_ratio} for session: ${conversation_id}\nThis will apply to both image generation and editing.`,
          }],
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