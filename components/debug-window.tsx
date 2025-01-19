'use client';

import { useEffect, useRef, useState } from 'react';
import { Message } from 'ai';
import { cn } from '@/lib/utils';

interface DebugWindowProps {
  messages: Message[];
  className?: string;
}

export function DebugWindow({ messages, className }: DebugWindowProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [prompts, setPrompts] = useState<any[]>([]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, prompts]);

  useEffect(() => {
    // Extract debug data from messages
    const debugData = messages
      .filter(msg => msg.role === 'assistant' && msg.content && typeof msg.content === 'string' && msg.content.includes('"type":"prompts"'))
      .map(msg => {
        try {
          return JSON.parse(msg.content);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
    
    setPrompts(debugData);
  }, [messages]);

  return (
    <div
      className={cn(
        'fixed right-0 top-0 h-full bg-background border-l w-96 transition-all duration-200 ease-in-out',
        isExpanded ? 'translate-x-0' : 'translate-x-[calc(100%-24px)]',
        className
      )}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 bg-background border rounded-l-md p-1.5 hover:bg-accent"
      >
        {isExpanded ? '→' : '←'}
      </button>
      
      <div className="p-4 h-full flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">Debug Logs</h3>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto font-mono text-sm"
        >
          {prompts.length > 0 && (
            <div className="mb-6">
              <div className="text-blue-500 font-semibold mb-2">Model Prompts:</div>
              {prompts.map((prompt, index) => (
                <div key={index} className="mb-4 p-2 border rounded">
                  <div className="text-muted-foreground mb-2">System Prompt:</div>
                  <pre className="whitespace-pre-wrap break-all text-xs mb-4">{prompt.system}</pre>
                  <div className="text-muted-foreground mb-2">Messages:</div>
                  <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(prompt.messages, null, 2)}</pre>
                </div>
              ))}
            </div>
          )}

          {messages.map((message, index) => (
            <div key={index} className="mb-4">
              <div className="text-muted-foreground">
                {new Date().toISOString()} - {message.role}:
              </div>
              <div className="whitespace-pre-wrap break-all">
                {JSON.stringify(message, null, 2)}
              </div>
              {message.toolInvocations && (
                <div className="mt-2 text-blue-500">
                  Tool Invocations:
                  <div className="whitespace-pre-wrap break-all">
                    {JSON.stringify(message.toolInvocations, null, 2)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 