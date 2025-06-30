"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// server.ts
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
// Constants
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = 'sk-971588ce09d64d809b74f6dc0641dca7';
const DB_FILE = path_1.default.join(__dirname, 'projects_db.json');
const PROJECTS_DIR = path_1.default.join(__dirname, 'Projects');
const PORT = process.env.PORT || 5000;
// Initialize Express
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Database Operations
const initializeDB = async () => {
    try {
        await promises_1.default.access(DB_FILE);
        const data = await promises_1.default.readFile(DB_FILE, 'utf-8');
        return JSON.parse(data);
    }
    catch (error) {
        const initialData = { projects: [] };
        await promises_1.default.writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
};
const saveProject = async (project) => {
    const db = await initializeDB();
    const existingIndex = db.projects.findIndex(p => p.projectName === project.projectName);
    if (existingIndex >= 0) {
        db.projects[existingIndex] = {
            ...project,
            updatedAt: new Date().toISOString()
        };
    }
    else {
        db.projects.push({
            ...project,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
    await promises_1.default.writeFile(DB_FILE, JSON.stringify(db, null, 2));
};
const loadProject = async (projectName) => {
    const db = await initializeDB();
    return db.projects.find(p => p.projectName === projectName) || null;
};
const listProjects = async () => {
    const db = await initializeDB();
    return db.projects;
};
// API Operations
const generateWithDeepSeek = async (prompt, context) => {
    try {
        const response = await axios_1.default.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                {
                    role: "system",
                    content: (context || "You are a professional web developer. Generate clean, modern HTML with Tailwind CSS and Alpine.js.") +
                        "\n\nIMPORTANT: Return ONLY the raw HTML code without any additional text, explanations, or markdown formatting." +
                        "Do not include any introductory sentences or code block markers like ```html."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 8000
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        let htmlContent = response.data.choices[0].message.content;
        htmlContent = htmlContent.replace(/```html/g, '').replace(/```/g, '');
        const htmlStart = htmlContent.indexOf('<!DOCTYPE html>');
        return htmlStart >= 0
            ? htmlContent.substring(htmlStart).trim()
            : htmlContent.trim();
    }
    catch (error) {
        console.error('API Error:', error instanceof Error ? error.message : 'Unknown error');
        throw new Error('Failed to generate content');
    }
};
// Project Operations
const generateProjectName = async (prompt) => {
    const namePrompt = `Based on this project description: "${prompt}", suggest a concise, professional project name as a single lowercase string with hyphens, no spaces. Only return the name, no other text.`;
    const projectName = await generateWithDeepSeek(namePrompt);
    return projectName.trim().replace(/\s+/g, '-').toLowerCase();
};
const generatePageDescriptions = async (prompt, pageNames) => {
    const pagesPrompt = `
    For a website with this description: "${prompt}",
    generate detailed descriptions for these pages: ${pageNames.join(', ')}.

    For each page, provide:
    1. A 2-3 sentence description
    2. Key elements to include
    3. Appropriate tone/style

    Return in this exact JSON format:
    [
      {
        "name": "Page Name",
        "description": "Page description",
        "fileName": "page-name.html",
        "generated": false
      }
    ]
    Only return the JSON array, no additional text.
  `;
    const response = await generateWithDeepSeek(pagesPrompt);
    try {
        const jsonStart = response.indexOf('[');
        const jsonEnd = response.lastIndexOf(']') + 1;
        return JSON.parse(response.slice(jsonStart, jsonEnd));
    }
    catch (error) {
        console.error('JSON Parse Error:', error);
        throw new Error('Failed to parse page descriptions');
    }
};
const generateIndexHtml = async (prompt, projectName, style, pages) => {
    const pagesList = pages.map(p => `- ${p.name}: ${p.description}`).join('\n');
    const indexPrompt = `
    Create a professional ${style} HTML file using Tailwind CSS and Alpine.js based on:
    Project: ${projectName}
    Description: ${prompt}

    Pages:
    ${pagesList}

    Requirements:
    - HTML5 semantic structure
    - Responsive navigation
    - Pages link is just pagename.html
    - Tailwind CSS (CDN)
    - Dark mode toggle
    - Everything is interactive Using alpine Js
    - No external links, use icons for previews
    Return only raw HTML code.
  `;
    return generateWithDeepSeek(indexPrompt);
};
const generateAdditionalPages = async (project, indexHtml) => {
    const pagesDir = path_1.default.join(PROJECTS_DIR, project.projectName);
    await promises_1.default.mkdir(pagesDir, { recursive: true });
    const context = `The index.html content is: ${indexHtml}`;
    const totalPages = project.pages.length;
    for (let i = 0; i < totalPages; i++) {
        const page = project.pages[i];
        const pagePrompt = `
      Create a ${page.name} page matching the style of the provided index.html.
      Purpose: ${page.description}
      Return ONLY raw HTML code.
    `;
        const pageContent = await generateWithDeepSeek(pagePrompt, context);
        await promises_1.default.writeFile(path_1.default.join(pagesDir, page.fileName), pageContent);
        // Update project progress and last generated file
        project.pages[i].generated = true;
        project.progress = Math.floor(((i + 1) / totalPages) * 30) + 40; // Pages generation is 40-70% of progress
        project.lastGeneratedFile = page.fileName;
        project.generatedFiles.push({
            name: page.name,
            path: path_1.default.join(pagesDir, page.fileName),
            type: 'page',
            generatedAt: new Date().toISOString()
        });
        await saveProject(project);
    }
};
const generateProjectStructure = async (project) => {
    const projectDir = path_1.default.join(PROJECTS_DIR, project.projectName);
    const dirs = [
        path_1.default.join(projectDir, 'assets/css'),
        path_1.default.join(projectDir, 'assets/js'),
        path_1.default.join(projectDir, 'assets/images')
    ];
    await Promise.all(dirs.map(dir => promises_1.default.mkdir(dir, { recursive: true })));
    const cssContent = `/* Custom CSS for ${project.projectName} */\n\n@tailwind base;\n@tailwind components;\n@tailwind utilities;`;
    const jsContent = `// Custom JS for ${project.projectName}\n\ndocument.addEventListener('alpine:init', () => {\n  // Alpine.js initialization\n});`;
    await Promise.all([
        promises_1.default.writeFile(path_1.default.join(dirs[0], 'styles.css'), cssContent),
        promises_1.default.writeFile(path_1.default.join(dirs[1], 'app.js'), jsContent)
    ]);
    // Update project with generated assets
    project.generatedFiles.push({
        name: 'styles.css',
        path: path_1.default.join(dirs[0], 'styles.css'),
        type: 'asset',
        generatedAt: new Date().toISOString()
    }, {
        name: 'app.js',
        path: path_1.default.join(dirs[1], 'app.js'),
        type: 'asset',
        generatedAt: new Date().toISOString()
    });
    project.lastGeneratedFile = 'assets';
    project.progress = 20; // Structure generation is 20% of progress
    await saveProject(project);
};
const createProjectDocumentation = async (project) => {
    const docsContent = `
# ${project.projectName}

## Description
${project.prompt}

## Style
${project.style}

## Pages
${project.pages.map(p => `### ${p.name}\n**File:** ${p.fileName}\n\n${p.description}`).join('\n\n')}

## Structure
- /assets
  - /css
  - /js
  - /images
- /pages
  - ${project.pages.map(p => p.fileName).join('\n  - ')}
- index.html

Generated by Professional Website Generator
  `.trim();
    const docsPath = path_1.default.join(PROJECTS_DIR, project.projectName, 'PROJECT_DOCS.md');
    await promises_1.default.writeFile(docsPath, docsContent);
    // Update project with documentation
    project.generatedFiles.push({
        name: 'PROJECT_DOCS.md',
        path: docsPath,
        type: 'documentation',
        generatedAt: new Date().toISOString()
    });
    project.lastGeneratedFile = 'PROJECT_DOCS.md';
    project.progress = 90; // Documentation is 90% of progress
    await saveProject(project);
};
// API Endpoints
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await listProjects();
        res.json(projects);
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to fetch projects',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Add these endpoints with the others in the "API Endpoints" section
// Get list of files with optional content
app.get('/api/projects/:projectId/files', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const { includeContent } = req.query;
        const project = await loadProject(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const projectDir = path_1.default.join(PROJECTS_DIR, projectId);
        const files = await getAllFilesWithContent(projectDir, includeContent === 'true');
        res.json({
            projectId,
            projectName: project.projectName,
            files: files.map(file => ({
                name: path_1.default.basename(file.path),
                path: file.path.replace(projectDir, ''),
                type: path_1.default.extname(file.path).substring(1) || 'unknown',
                size: file.size,
                content: file.content,
                lastModified: file.lastModified
            })),
            generatedFiles: project.generatedFiles.map(f => ({
                name: f.name,
                path: f.path.replace(projectDir, ''),
                type: f.type,
                generatedAt: f.generatedAt
            }))
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to get project files',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Get specific file content
app.get('/api/projects/:projectId/files/*', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        // @ts-ignore
        const filePath = req.params[0];
        const project = await loadProject(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const fullPath = path_1.default.join(PROJECTS_DIR, projectId, filePath);
        // Security check to prevent directory traversal
        if (!fullPath.startsWith(path_1.default.join(PROJECTS_DIR, projectId))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const stats = await promises_1.default.stat(fullPath);
        if (stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is a directory' });
        }
        const content = await promises_1.default.readFile(fullPath, 'utf-8');
        const fileType = path_1.default.extname(fullPath).substring(1) || 'unknown';
        res.json({
            projectId,
            path: filePath,
            name: path_1.default.basename(fullPath),
            type: fileType,
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            content: content
        });
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        }
        else {
            res.status(500).json({
                error: 'Failed to get file content',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
});
// Helper function to recursively get all files with optional content
async function getAllFilesWithContent(dir, includeContent) {
    const dirents = await promises_1.default.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map(async (dirent) => {
        const res = path_1.default.resolve(dir, dirent.name);
        if (dirent.isDirectory()) {
            return getAllFilesWithContent(res, includeContent);
        }
        else {
            const stats = await promises_1.default.stat(res);
            const fileData = {
                path: res,
                size: stats.size,
                lastModified: stats.mtime
            };
            if (includeContent) {
                fileData.content = await promises_1.default.readFile(res, 'utf-8');
            }
            return fileData;
        }
    }));
    return files.flat();
}
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt, style = 'modern' } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        // Generate initial response
        const projectName = await generateProjectName(prompt);
        // Create initial project record
        const project = {
            projectName,
            prompt,
            pages: [],
            style: style,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'processing',
            progress: 5, // Initial progress
            generatedFiles: [],
            lastGeneratedFile: 'Initializing project'
        };
        await saveProject(project);
        // Start background processing
        processProjectGeneration(project);
        res.json({
            projectId: project.projectName,
            status: project.status,
            progress: project.progress,
            message: 'Project generation started',
            details: {
                lastGenerated: project.lastGeneratedFile,
                filesGenerated: project.generatedFiles.length
            }
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Project generation failed',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
app.get('/api/status/:projectId', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const project = await loadProject(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json({
            projectId,
            status: project.status,
            progress: project.progress,
            details: {
                name: project.projectName,
                style: project.style,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                lastGeneratedFile: project.lastGeneratedFile,
                filesGenerated: project.generatedFiles.length,
                pages: project.pages.map(p => ({
                    name: p.name,
                    file: p.fileName,
                    generated: p.generated
                })),
                assets: project.generatedFiles.filter(f => f.type === 'asset').map(f => ({
                    name: f.name,
                    path: f.path.replace(PROJECTS_DIR, '')
                }))
            }
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to check status',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
app.get('/api/download/:projectId', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const project = await loadProject(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        if (project.status !== 'completed') {
            return res.status(400).json({
                error: 'Project not ready',
                status: project.status,
                progress: project.progress
            });
        }
        // In a real implementation, you would zip the folder here
        // For now, we'll return the project directory path
        res.json({
            projectId,
            downloadUrl: `/api/projects/${projectId}/download`,
            project: {
                name: project.projectName,
                files: project.generatedFiles.map(f => ({
                    name: f.name,
                    type: f.type,
                    path: f.path.replace(PROJECTS_DIR, '')
                }))
            }
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Download failed',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
app.get('/api/preview/:projectId/:filename', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const filename = req.params.filename;
        const filePath = path_1.default.join(PROJECTS_DIR, projectId, filename);
        // Send the HTML file
        res.sendFile(filePath);
    }
    catch (error) {
        res.status(500).json({
            error: 'Preview failed',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Background processing
async function processProjectGeneration(project) {
    try {
        // Update project status
        project.status = 'processing';
        project.progress = 10; // Starting processing
        await saveProject(project);
        // Generate page descriptions
        const pagesResponse = await generateWithDeepSeek(`Based on: "${project.prompt}", list needed pages as comma-separated names.`);
        const pageNames = pagesResponse.split(',').map(p => p.trim()).filter(Boolean);
        project.pages = await generatePageDescriptions(project.prompt, pageNames);
        project.progress = 15; // Page descriptions generated
        project.lastGeneratedFile = 'Page descriptions';
        await saveProject(project);
        // Generate project structure
        await generateProjectStructure(project);
        // Generate index.html
        const indexHtml = await generateIndexHtml(project.prompt, project.projectName, project.style, project.pages);
        const indexPath = path_1.default.join(PROJECTS_DIR, project.projectName, 'index.html');
        await promises_1.default.writeFile(indexPath, indexHtml);
        // Update project with index.html
        project.generatedFiles.push({
            name: 'index.html',
            path: indexPath,
            type: 'page',
            generatedAt: new Date().toISOString()
        });
        project.progress = 40; // Index.html generated
        project.lastGeneratedFile = 'index.html';
        await saveProject(project);
        // Generate additional pages
        await generateAdditionalPages(project, indexHtml);
        // Create documentation
        await createProjectDocumentation(project);
        // Update project status
        project.status = 'completed';
        project.progress = 100;
        project.updatedAt = new Date().toISOString();
        project.lastGeneratedFile = 'All files generated';
        await saveProject(project);
    }
    catch (error) {
        console.error('Background processing error:', error);
        // Update project status
        project.status = 'failed';
        project.updatedAt = new Date().toISOString();
        project.lastGeneratedFile = 'Error during generation';
        await saveProject(project);
    }
}
// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Ensure Projects directory exists
    promises_1.default.mkdir(PROJECTS_DIR, { recursive: true }).catch(console.error);
});
