import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

async function testImageGeneration() {
  try {
    console.log('Testing image generation...');
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: 'A serene beach scene with turquoise water and sunset',
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '2K',
          personGeneration: 'allow_adult',
        },
      },
    });

    console.log('Response received!');
    
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.text) {
          console.log('Text:', part.text);
        } else if (part.inlineData) {
          console.log('Image generated! MIME type:', part.inlineData.mimeType);
          const buffer = Buffer.from(part.inlineData.data, 'base64');
          fs.writeFileSync('test_output.png', buffer);
          console.log('Saved to test_output.png');
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testImageGeneration();
