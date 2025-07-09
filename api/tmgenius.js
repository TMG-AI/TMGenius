// api/tmgenius.js - TMGenius Integration with File Text Extraction
import Busboy from 'busboy';
import fetch from 'node-fetch';
import zlib from 'zlib';

export const config = {
  api: {
    bodyParser: false,
    maxDuration: 800,
  },
};

// Simple text extraction function
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
        // For PDF, DOC, etc. - return filename and size info
        return `[File: ${filename} (${buffer.length} bytes) - Content extraction not available for this file type]`;
    }
  } catch (error) {
    return `[File: ${filename} - Error reading file content]`;
  }
}

export default async function handler(req, res) {
  console.log('🚀 TMGenius API called - Method:', req.method);
  
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
        
        console.log(`📎 Processing file: ${filename} (${buffer.length} bytes)`);
        
        // Extract text content from file
        const textContent = extractTextFromFile(buffer, filename);
        fileContents.push({
          filename,
          content: textContent
        });
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

    // 🔧 ENHANCED PROMPT: Combine user prompt + file contents
    let enhancedPrompt = prompt;
    
    if (fileContents.length > 0) {
      enhancedPrompt += '\n\n--- UPLOADED DOCUMENTS ---\n';
      fileContents.forEach((file, index) => {
        enhancedPrompt += `\nDocument ${index + 1}: ${file.filename}\n`;
        enhancedPrompt += `Content:\n${file.content}\n`;
        enhancedPrompt += '---\n';
      });
    }

    console.log('📝 Enhanced prompt length:', enhancedPrompt.length);
    console.log('📎 Files processed:', fileContents.length);

    // Send enhanced prompt to n8n via GET (that works!)
    const tmgeniusUrl = `https://swheatman.app.n8n.cloud/webhook/8c7f9c77-c7a2-4316-ba2a-3b9ffefd4bf7?prompt=${encodeURIComponent(enhancedPrompt)}`;
    
    const tmgeniusResponse = await fetch(tmgeniusUrl, {
      method: 'GET',
      timeout: 800000
    });

    if (!tmgeniusResponse.ok) {
      const errorText = await tmgeniusResponse.text();
      console.error('❌ TMGenius error:', errorText);
      return res.status(500).json({ error: 'TMGenius processing failed', details: errorText });
    }

    const responseText = await tmgeniusResponse.text();
    const responseData = JSON.parse(responseText);

    console.log('✅ TMGenius response received');

    // Return results directly to dashboard
    const jsonString = JSON.stringify(responseData);
    const compressedData = zlib.gzipSync(jsonString);
    
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Type', 'application/json');
    return res.send(compressedData);

  } catch (error) {
    console.error('💥 TMGenius API error:', error.message);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
