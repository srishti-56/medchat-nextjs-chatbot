# Developer Documentation - AI Chatbot

This document provides technical details about the architecture and structure of the AI Chatbot application.

## Architecture Overview

The application is built using Next.js 14 with the App Router and follows a modern, component-based architecture with server-side rendering capabilities. Here's a breakdown of the main architectural components:

### Core Technologies

- **Next.js 14**: Frontend framework with App Router for server-side rendering
- **Vercel AI SDK**: Powers the AI interactions and chat functionality
- **shadcn/ui**: UI component library built on Tailwind CSS
- **NextAuth.js**: Authentication system
- **Vercel Postgres**: Database for chat history and user data
- **Vercel Blob**: File storage system

## Directory Structure

```
├── app/                    # Main application code (Next.js App Router)
│   ├── (auth)/            # Authentication-related routes and components
│   ├── (chat)/            # Chat interface and related components
│   ├── layout.tsx         # Root layout component
│   └── globals.css        # Global styles
├── components/            # Reusable UI components
├── lib/                   # Utility functions and shared logic
├── hooks/                 # Custom React hooks
├── public/               # Static assets
└── middleware.ts         # Next.js middleware for auth and routing
```

### Key Components Explained

1. **App Directory (`/app`)**
   - Uses Next.js 14 App Router architecture
   - `(auth)`: Authentication flows and protected routes
   - `(chat)`: Main chat interface and conversation logic
   - `layout.tsx`: Root layout with common UI elements

2. **Components Directory (`/components`)**
   - Contains reusable UI components
   - Built using shadcn/ui and Tailwind CSS
   - Includes chat interface elements, forms, and UI primitives

3. **Library (`/lib`)**
   - Utility functions
   - Database configurations
   - API integrations
   - Type definitions

4. **Hooks (`/hooks`)**
   - Custom React hooks for chat functionality
   - State management hooks
   - Authentication hooks

## Data Flow

1. **Chat Flow**
   - User input is processed through the AI SDK
   - Messages are streamed using Server-Sent Events (SSE)
   - Responses are generated using the configured LLM (default: GPT-4)
   - Chat history is persisted in Vercel Postgres

2. **Authentication Flow**
   - Handled by NextAuth.js
   - Protected routes and API endpoints
   - Session management

## Key Features

1. **Real-time Chat**
   - Streaming responses
   - Message persistence
   - File attachments support

2. **Authentication**
   - Secure user authentication
   - Protected routes
   - Session management

3. **UI/UX**
   - Responsive design
   - Accessible components
   - Modern styling with Tailwind CSS

## Development Guidelines

1. **Environment Setup**
   - Copy `.env.example` to `.env`
   - Configure required API keys and secrets
   - Set up Vercel Postgres and Blob storage

2. **Local Development**
   ```bash
   pnpm install
   pnpm dev
   ```

3. **Database**
   - Uses Vercel Postgres
   - Migrations handled through project configuration
   - Chat history and user data storage

4. **AI Integration**
   - Default: OpenAI GPT-4
   - Configurable for other providers through AI SDK
   - Streaming response handling

## Deployment

- Optimized for Vercel deployment
- Environment variables must be configured in Vercel dashboard
- Automatic preview deployments for PRs

## Security Considerations

1. **Authentication**
   - Secure session management
   - Protected API routes
   - Environment variable security

2. **Data Storage**
   - Secure database connections
   - Encrypted storage
   - User data protection

## Performance Optimization

1. **Server Components**
   - Leverages Next.js React Server Components
   - Reduced client-side JavaScript
   - Optimized loading states

2. **Caching**
   - Static asset caching
   - API response caching
   - Database query optimization

## Customization

1. **UI Theming**
   - Tailwind CSS configuration
   - shadcn/ui component customization
   - Global styles in `globals.css`

2. **AI Models**
   - Configurable through AI SDK
   - Support for multiple providers
   - Custom prompt engineering 

### Detailed Component Breakdown

The `components/` directory contains a rich set of UI components that power the chat interface:

#### Core Chat Components
- `chat.tsx`: Main chat container component
- `messages.tsx`: Messages list container
- `message.tsx`: Individual message component with markdown support
- `message-actions.tsx`: Actions available for each message
- `multimodal-input.tsx`: Handles text, file, and multi-modal inputs

#### Editor and Code Components
- `code-editor.tsx`: Monaco-based code editor
- `code-block.tsx`: Syntax-highlighted code display
- `run-code-button.tsx`: Code execution functionality
- `diffview.tsx`: Shows code differences
- `console.tsx`: Command output display

#### UI Components
- `ui/`: Base UI components from shadcn/ui
- `toolbar.tsx`: Main application toolbar
- `sidebar-history.tsx`: Chat history sidebar
- `theme-provider.tsx`: Dark/light theme management
- `block.tsx`: Content block container

#### Input and Interaction
- `editor.tsx`: Rich text editor component
- `message-editor.tsx`: Message composition interface
- `document-preview.tsx`: File preview functionality
- `multimodal-input.tsx`: Handles various input types

#### Authentication and User
- `auth-form.tsx`: Authentication interface
- `sidebar-user-nav.tsx`: User navigation component
- `sign-out-form.tsx`: Sign out functionality

#### Utility Components
- `markdown.tsx`: Markdown rendering
- `icons.tsx`: SVG icon components
- `data-stream-handler.tsx`: Handles streaming responses 

## Backend Architecture

The `lib/` directory contains core backend functionality and utilities:

### AI Integration (`lib/ai/`)
- AI model configuration and integration
- Prompt engineering and response handling
- Streaming response utilities
- Model provider abstractions

### Database Layer (`lib/db/`)
- Database schema and migrations
- Chat history persistence
- User data management
- Query utilities

### Editor Integration (`lib/editor/`)
- Code editor configuration
- Syntax highlighting
- Language support
- Editor state management

### Utility Functions (`utils.ts`)
- Helper functions
- Type definitions
- Common constants
- Shared utilities

## Technical Implementation Details

### AI Processing Flow
1. User input is captured through the chat interface
2. Input is processed by the AI SDK
3. Requests are streamed to the selected model provider
4. Responses are processed and streamed back to the UI
5. Chat history is persisted to the database

### Data Persistence
1. Chat messages are stored in Vercel Postgres
2. File attachments are stored in Vercel Blob
3. User sessions are managed through NextAuth.js
4. Real-time updates use Server-Sent Events

### Security Implementation
1. Authentication flow:
   - OAuth provider integration
   - Session management
   - Protected API routes
2. Data security:
   - Encrypted storage
   - Secure API calls
   - Environment variable protection

### Performance Features
1. Streaming responses for real-time interaction
2. Optimized database queries
3. Efficient file handling
4. Client-side caching
5. Server-side rendering for initial load 

## Tools and Actions

### Tool System Architecture
1. **Tool Definition**
   - Tools are defined in `app/(chat)/api/chat/route.ts`
   - Each tool has a description, parameters (using Zod schema), and execute function
   - Tools are typed with `AllowedTools` type

2. **Available Tools**
   ```typescript
   type AllowedTools =
     | 'createDocument'
     | 'updateDocument'
     | 'requestSuggestions'
     | 'getWeather';
   ```

3. **Tool Implementation**
   - Tools can be synchronous or asynchronous
   - Tools can return structured data
   - Tools can write to data stream for real-time updates

4. **Custom Tool Example**
   ```typescript
   getWeather: {
     description: 'Get the current weather at a location',
     parameters: z.object({
       latitude: z.number(),
       longitude: z.number(),
     }),
     execute: async ({ latitude, longitude }) => {
       // Implementation
     }
   }
   ```

## Model Configuration

### Model Integration
1. **Default Configuration**
   - Default model: OpenAI GPT-4
   - Model configuration in `lib/ai/models.ts`
   - Support for multiple model providers

2. **Adding New Models**
   - Models can be added in the models configuration
   - Each model requires:
     - ID
     - Name
     - API identifier
     - Provider configuration

3. **Model Selection**
   - Models are selectable through UI
   - Model preference is stored in cookies
   - Model can be changed per conversation

4. **Using Alternative Models (e.g., Mistral)**
   ```typescript
   // Example configuration in lib/ai/models.ts
   {
     id: 'mistral-7b',
     name: 'Mistral 7B',
     apiIdentifier: 'mistral/7b',
     // Additional configuration
   }
   ```

## UI Update Architecture

### Message Flow Architecture
1. **Components**
   - `Chat.tsx`: Main container
   - `Messages.tsx`: Message list
   - `Message.tsx`: Individual message
   - `DataStreamHandler.tsx`: Handles streaming updates

2. **Key Hooks**
   - `useChat`: Core chat functionality from AI SDK
   - `useScrollToBottom`: Auto-scroll behavior
   - `useChatVisibility`: Chat visibility state
   - `useBlock`: Block state management

3. **Data Flow**
   ```
   User Input → useChat → AI SDK → Server
        ↓                             ↓
   UI Update ← DataStream ← SSE Response
   ```

### Real-time Updates
1. **Streaming Implementation**
   - Uses Server-Sent Events (SSE)
   - Handled by `DataStreamHandler`
   - Supports multiple types of updates:
     ```typescript
     type DataStreamDelta = {
       type: 'text-delta' | 'code-delta' | 'title' | 'id' | 'suggestion' | 'clear' | 'finish' | 'user-message-id' | 'kind';
       content: string | Suggestion;
     };
     ```

2. **State Management**
   - Message state managed by `useChat`
   - UI state managed by React hooks
   - Persistent state in Vercel Postgres

3. **UI Components Update Flow**
   ```
   DataStreamHandler
     ↓
   useChat (state update)
     ↓
   Messages Component
     ↓
   Individual Message Components
   ```

### Custom Hooks
1. **useChat**
   - Provided by AI SDK
   - Manages chat state and interactions
   - Handles message streaming

2. **useBlock**
   - Manages block-based UI state
   - Handles document and code blocks
   - Manages visibility and interactions

3. **useChatVisibility**
   - Manages chat visibility state
   - Handles public/private toggle
   - Syncs with backend

4. **useScrollToBottom**
   - Manages chat scroll behavior
   - Auto-scrolls on new messages
   - Handles smooth scrolling 