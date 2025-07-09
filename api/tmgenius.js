// api/tmgenius.js - Fixed CORS and fetch issues
import Busboy from 'busboy';

export const config = {
  api: {
    bodyParser: false,
    maxDuration: 60, // Reduce timeout
  },
};

function extractTextFromFile(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  
  try {
    switch (ext) {
      case 'txt':
      case 'md':
      case 'json':
        return buffer.toString('utf8');
      case 'csv':
        return buffer.toString('utf8');
      default:
        return `[File: ${filename} (${buffer.length} bytes) - Content extraction not available for this file type]`;
    }
  } catch (error) {
    return `[File: ${filename} - Error reading file content]`;
  }
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const busboy = Busboy({ 
      headers: req.headers,
      limits: { fileSize: 10 * 1024 * 1024, files: 5 }
    });
    
    let prompt = '';
    const fileContents = [];

    busboy.on('field', (fieldname, value) => {
      if (fieldname === 'prompt') prompt = value;
    });

    busboy.on('file', (fieldname, file, info) => {
      const chunks = [];
      file.on('data', chunk => chunks.push(chunk));
      file.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const filename = info.filename || `document-${Date.now()}`;
        const textContent = extractTextFromFile(buffer, filename);
        fileContents.push({ filename, content: textContent });
      });
    });

    req.pipe(busboy);

    await new Promise((resolve, reject) => {
      busboy.on('finish', resolve);
      busboy.on('error', reject);
      setTimeout(() => reject(new Error('Upload timeout')), 30000);
    });

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Create enhanced prompt
    let enhancedPrompt = prompt;
    if (fileContents.length > 0) {
      enhancedPrompt += '\n\n--- UPLOADED DOCUMENTS ---\n';
      fileContents.forEach((file, index) => {
        enhancedPrompt += `\nDocument ${index + 1}: ${file.filename}\n`;
        enhancedPrompt += `Content:\n${file.content}\n---\n`;
      });
    }

    // 🔧 FIXED: Return the enhanced prompt to frontend instead of calling n8n directly
    return res.status(200).json({
      enhancedPrompt,
      filesProcessed: fileContents.length,
      originalPrompt: prompt
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
