import {
  type Message,
  convertToCoreMessages,
  createDataStreamResponse,
  streamObject,
  streamText
} from 'ai';
import { z } from 'zod';

import { auth } from '@/app/(auth)/auth';
import { customModel } from '@/lib/ai';
import { models } from '@/lib/ai/models';
import {
  systemPrompt,
  regularPrompt,
  updateDocumentPrompt
} from '@/lib/ai/prompts';
import {
  deleteChatById,
  getChatById,
  getDocumentById,
  saveChat,
  saveDocument,
  saveMessages,
  saveSuggestions,
  getDoctorBySpeciality,
  updateUserInfo,
  getUserById
} from '@/lib/db/queries';
import type { Suggestion } from '@/lib/db/schema';
import {
  generateUUID,
  getMostRecentUserMessage,
  sanitizeResponseMessages,
} from '@/lib/utils';

import { generateTitleFromUserMessage } from '../../actions';

export const maxDuration = 60;

type AllowedTools =
  | 'createDocument'
  | 'updateDocument'
  | 'requestSuggestions'
  | 'getWeather'
  | 'getDoctorBySpeciality'
  | 'validatePatientFile'
  | 'updateUserInfo'
  | 'diagnoseIssue';

const blocksTools: Array<AllowedTools> = [
  'createDocument',
  'updateDocument',
  'requestSuggestions',
  'validatePatientFile'
];

const weatherTools: Array<AllowedTools> = ['getWeather'];

const doctorTools: Array<AllowedTools> = ['getDoctorBySpeciality', 'diagnoseIssue'];

const allTools: Array<AllowedTools> = [...blocksTools, ...weatherTools, ...doctorTools, 'updateUserInfo'];

// Gradio endpoint (commented out but kept for reference)
// const GRADIO_URL = "https://segadeds-medical-diagnosis.hf.space/run/predict";

// MedLLaMA endpoint
const MEDLLAMA_URL = "https://api-inference.huggingface.co/models/ProbeMedicalYonseiMAILab/medllama3-v20";

async function queryMedicalDiagnosis(text: string) {
  // Previous Gradio implementation
  /*
  const response = await fetch(GRADIO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [text]
    })
  });
  */

  // Current MedLLaMA implementation
  const response = await fetch(MEDLLAMA_URL, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`
    },
    body: JSON.stringify({
      inputs: text,
      parameters: {
        max_new_tokens: 500,
        temperature: 0.7,
        top_p: 0.9,
        do_sample: true,
        return_full_text: false
      }
    })
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return await response.json();
}

export async function POST(request: Request) {
  const {
    id,
    messages,
    modelId,
  }: { id: string; messages: Array<Message>; modelId: string } =
    await request.json();

  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const model = models.find((model) => model.id === modelId);

  if (!model) {
    return new Response('Model not found', { status: 404 });
  }

  const coreMessages = convertToCoreMessages(messages);
  const userMessage = getMostRecentUserMessage(coreMessages);

  if (!userMessage) {
    return new Response('No user message found', { status: 400 });
  }

  // Get user info if this is the first message
  if (coreMessages.length === 1) {
    const userInfo = await getUserById(session.user.id);
    if (userInfo?.name || userInfo?.age) {
      // Append user info to the first message
      const userInfoStr = `\n\nUser Info:\n${userInfo.name ? `Name: ${userInfo.name}\n` : ''}${userInfo.age ? `Age: ${userInfo.age}` : ''}`;
      userMessage.content = `${userMessage.content}${userInfoStr}`;
    }
  }

  const chat = await getChatById({ id });

  if (!chat) {
    const title = await generateTitleFromUserMessage({ message: userMessage });
    await saveChat({ id, userId: session.user.id, title });
  }

  const userMessageId = generateUUID();

  await saveMessages({
    messages: [
      { ...userMessage, id: userMessageId, createdAt: new Date(), chatId: id },
    ],
  });

  return createDataStreamResponse({
    execute: (dataStream) => {
      dataStream.writeData({
        type: 'user-message-id',
        content: userMessageId,
      });

      // Add debug data for prompts
      dataStream.writeData({
        type: 'debug',
        content: JSON.stringify({
          type: 'prompts',
          system: systemPrompt,
          messages: coreMessages.map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          }))
        })
      });

      const result = streamText({
        model: customModel(model.apiIdentifier),
        system: systemPrompt,
        messages: coreMessages,
        maxSteps: 5,
        experimental_activeTools: ['createDocument', 'updateDocument', 'requestSuggestions', 'getWeather', 'getDoctorBySpeciality', 'validatePatientFile', 'updateUserInfo', 'diagnoseIssue'],
        tools: {
          getWeather: {
            description: 'Get the current weather at a location',
            parameters: z.object({
              latitude: z.number(),
              longitude: z.number(),
            }),
            execute: async ({ latitude, longitude }) => {
              const response = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`,
              );

              const weatherData = await response.json();
              return weatherData;
            },
          },
          createDocument: {
            description: 'Create a patient file or other medical document',
            parameters: z.object({
              title: z.string(),
              kind: z.enum(['text', 'code']),
            }),
            execute: async ({ title, kind }) => {
              const id = generateUUID();
              let draftText = '';

              dataStream.writeData({
                type: 'id',
                content: id,
              });

              dataStream.writeData({
                type: 'title',
                content: title,
              });

              dataStream.writeData({
                type: 'kind',
                content: kind,
              });

              dataStream.writeData({
                type: 'clear',
                content: '',
              });

              if (kind === 'text') {
                const { fullStream } = streamText({
                  model: customModel(model.apiIdentifier),
                  system: `Create a patient file if there's enough information in the chat.`,
                  prompt: title,
                });

                for await (const delta of fullStream) {
                  const { type } = delta;

                  if (type === 'text-delta') {
                    const { textDelta } = delta;

                    draftText += textDelta;
                    dataStream.writeData({
                      type: 'text-delta',
                      content: textDelta,
                    });
                  }
                }

                dataStream.writeData({ type: 'finish', content: '' });
              }

              if (session.user?.id) {
                await saveDocument({
                  id,
                  title,
                  kind,
                  content: draftText,
                  userId: session.user.id,
                });
              }

              return {
                id,
                title,
                kind,
                content:
                  'A patient file was created and is now visible to the user.',
              };
            },
          },
          updateDocument: {
            description: 'Update the patient file or medical document with new information',
            parameters: z.object({
              id: z.string().describe('The ID of the document to update'),
              description: z
                .string()
                .describe('The description of changes that need to be made'),
            }),
            execute: async ({ id, description }) => {
              const document = await getDocumentById({ id });

              if (!document) {
                return {
                  error: 'Document not found',
                };
              }

              const { content: currentContent } = document;
              let draftText = '';

              dataStream.writeData({
                type: 'clear',
                content: document.title,
              });

              if (document.kind === 'text') {
                const { fullStream } = streamText({
                  model: customModel(model.apiIdentifier),
                  system: updateDocumentPrompt(currentContent, 'text'),
                  prompt: description,
                  experimental_providerMetadata: {
                    openai: {
                      prediction: {
                        type: 'content',
                        content: currentContent,
                      },
                    },
                  },
                });

                for await (const delta of fullStream) {
                  const { type } = delta;

                  if (type === 'text-delta') {
                    const { textDelta } = delta;

                    draftText += textDelta;
                    dataStream.writeData({
                      type: 'text-delta',
                      content: textDelta,
                    });
                  }
                }

                dataStream.writeData({ type: 'finish', content: '' });
              }

              if (session.user?.id) {
                await saveDocument({
                  id,
                  title: document.title,
                  content: draftText,
                  kind: document.kind,
                  userId: session.user.id,
                });
              }

              return {
                id,
                title: document.title,
                kind: document.kind,
                content: 'The patient file has been updated successfully.',
              };
            },
          },
          requestSuggestions: {
            description: 'Request suggestions for a document',
            parameters: z.object({
              documentId: z
                .string()
                .describe('The ID of the document to request edits'),
            }),
            execute: async ({ documentId }) => {
              const document = await getDocumentById({ id: documentId });

              if (!document || !document.content) {
                return {
                  error: 'Document not found',
                };
              }

              const suggestions: Array<
                Omit<Suggestion, 'userId' | 'createdAt' | 'documentCreatedAt'>
              > = [];

              const { elementStream } = streamObject({
                model: customModel(model.apiIdentifier),
                system:
                  'You are a help writing assistant. Given a piece of writing, please offer suggestions to improve the piece of writing and describe the change. It is very important for the edits to contain full sentences instead of just words. Max 5 suggestions.',
                prompt: document.content,
                output: 'array',
                schema: z.object({
                  originalSentence: z
                    .string()
                    .describe('The original sentence'),
                  suggestedSentence: z
                    .string()
                    .describe('The suggested sentence'),
                  description: z
                    .string()
                    .describe('The description of the suggestion'),
                }),
              });

              for await (const element of elementStream) {
                const suggestion = {
                  originalText: element.originalSentence,
                  suggestedText: element.suggestedSentence,
                  description: element.description,
                  id: generateUUID(),
                  documentId: documentId,
                  isResolved: false,
                };

                dataStream.writeData({
                  type: 'suggestion',
                  content: suggestion,
                });

                suggestions.push(suggestion);
              }

              if (session.user?.id) {
                const userId = session.user.id;

                await saveSuggestions({
                  suggestions: suggestions.map((suggestion) => ({
                    ...suggestion,
                    userId,
                    createdAt: new Date(),
                    documentCreatedAt: document.createdAt,
                  })),
                });
              }

              return {
                id: documentId,
                title: document.title,
                kind: document.kind,
                message: 'Suggestions have been added to the document',
              };
            },
          },
          getDoctorBySpeciality: {
            description: 'Query doctors database by medical specialty and optionally filter by city',
            parameters: z.object({
              speciality: z.string().describe('The medical specialty to search for'),
              city: z.string().optional().describe('Optional city to filter doctors'),
            }),
            execute: async ({ speciality, city }) => {
              const doctors = await getDoctorBySpeciality(speciality);
              
              if (!doctors || doctors.length === 0) {
                return {
                  error: 'No doctors found for this specialty',
                  speciality,
                  internalOnly: true
                };
              }

              // Group doctors by city
              const doctorsByCity = doctors.reduce<Record<string, typeof doctors>>((acc, doctor) => {
                const docCity = doctor.city || 'Unknown';
                if (!acc[docCity]) {
                  acc[docCity] = [];
                }
                acc[docCity].push(doctor);
                return acc;
              }, {});

              let selectedDoctors;
              
              if (city) {
                // If city provided, try to get doctors from that city
                const cityDoctors = doctorsByCity[city];
                if (cityDoctors && cityDoctors.length > 0) {
                  selectedDoctors = cityDoctors.sort(() => 0.5 - Math.random()).slice(0, 2);
                }
              }
              
              if (!selectedDoctors) {
                // If no city provided or no doctors in specified city, pick from a random city
                const cities = Object.keys(doctorsByCity).filter(c => doctorsByCity[c].length >= 2);
                if (cities.length === 0) {
                  // If no city has 2+ doctors, just return up to 2 doctors from all available
                  selectedDoctors = doctors.sort(() => 0.5 - Math.random()).slice(0, 2);
                } else {
                  const randomCity = cities[Math.floor(Math.random() * cities.length)];
                  selectedDoctors = doctorsByCity[randomCity].sort(() => 0.5 - Math.random()).slice(0, 2);
                }
              }

              const doctorInfos = selectedDoctors.map(doctor => ({
                name: doctor.name,
                degree: doctor.degree,
                yoe: doctor.yoe,
                location: doctor.location,
                city: doctor.city,
                speciality: speciality,
                consultFee: doctor.consultFee
              }));

              // Write internal tool response
              dataStream.writeData({
                type: 'internal-tool-response',
                content: JSON.stringify({
                  message: `Found ${doctors.length} doctor(s) specializing in ${speciality}`,
                  doctorData: doctorInfos,
                  internalOnly: true
                })
              });

              return {
                message: `Found ${doctors.length} doctor(s) specializing in ${speciality}`,
                doctorData: doctorInfos,
                internalOnly: true
              };
            },
          },
          validatePatientFile: {
            description: 'Validate patient file content against chat history',
            parameters: z.object({
              documentId: z.string().describe('The ID of the document to validate'),
              messageNumber: z.number().describe('Current message number in the chat'),
            }),
            execute: async ({ documentId, messageNumber }) => {
              const document = await getDocumentById({ id: documentId });
              
              if (!document) {
                return {
                  error: 'Document not found',
                  documentId,
                };
              }

              // Extract facts from chat history
              const facts = coreMessages.map((msg, idx) => {
                if (msg.role === 'user') {
                  return {
                    messageNum: idx + 1,
                    content: msg.content
                  };
                }
                return null;
              }).filter(Boolean);

              dataStream.writeData({
                type: 'clear',
                content: document.title,
              });

              const { fullStream } = streamText({
                model: customModel(model.apiIdentifier),
                system: `You are validating a patient file against chat history.
1. Check if all information in the file is supported by chat messages
2. Each fact should have a reference [N] to the chat message number it came from
3. Information without a chat message source should be removed
4. Keep the exact same format but add references
5. If symptoms or complaints are mentioned multiple times, include all references`,
                prompt: JSON.stringify({
                  currentContent: document.content,
                  facts: facts,
                  messageNumber: messageNumber
                }),
                experimental_providerMetadata: {
                  openai: {
                    prediction: {
                      type: 'content',
                      content: document.content,
                    },
                  },
                },
              });

              let draftText = '';
              for await (const delta of fullStream) {
                const { type } = delta;
                if (type === 'text-delta') {
                  const { textDelta } = delta;
                  draftText += textDelta;
                  dataStream.writeData({
                    type: 'text-delta',
                    content: textDelta,
                  });
                }
              }

              dataStream.writeData({ type: 'finish', content: '' });

              if (session.user?.id) {
                await saveDocument({
                  id: documentId,
                  title: document.title,
                  content: draftText,
                  kind: document.kind,
                  userId: session.user.id,
                });
              }

              return {
                id: documentId,
                title: document.title,
                kind: document.kind,
                content: 'The patient file has been validated and updated with references.',
              };
            },
          },
          updateUserInfo: {
            description: 'Update user profile with name and age',
            parameters: z.object({
              name: z.string().optional(),
              age: z.string().optional(),
            }),
            execute: async ({ name, age }) => {
              if (!session?.user?.id) {
                return {
                  error: 'User not authenticated',
                  internalOnly: true
                };
              }

              try {
                await updateUserInfo({
                  userId: session.user.id,
                  name,
                  age,
                });

                // Write internal tool response
                dataStream.writeData({
                  type: 'internal-tool-response',
                  content: JSON.stringify({
                    message: 'User information updated successfully',
                    updates: { name, age },
                    internalOnly: true
                  })
                });

                return {
                  message: 'User information updated successfully',
                  updates: { name, age },
                  internalOnly: true
                };
              } catch (error) {
                console.error('Failed to update user info:', error);
                return {
                  error: 'Failed to update user information',
                  internalOnly: true
                };
              }
            },
          },
          diagnoseIssue: {
            description: 'Analyze symptoms and provide a preliminary diagnosis.',
            parameters: z.object({
              symptoms: z.array(z.string()).describe('List of symptoms reported by the patient'),
              duration: z.string().optional().describe('Duration of symptoms'),
              severity: z.string().optional().describe('Severity of symptoms'),
              age: z.string().optional().describe('Patient age'),
              gender: z.string().optional().describe('Patient gender'),
              medicalHistory: z.array(z.string()).optional().describe('Relevant medical history'),
              currentMedications: z.array(z.string()).optional().describe('Current medications'),
            }),
            execute: async ({ symptoms, duration, severity, age, gender, medicalHistory, currentMedications }) => {
              // Current MedLLaMA prompt format
              const prompt = `[INST] You are a medical AI assistant. Please analyze these patient symptoms and provide a preliminary diagnosis:

Patient Information:
- Age: ${age || 'Not provided'}
- Gender: ${gender || 'Not provided'}
- Symptoms: ${symptoms.join(', ')}
- Duration: ${duration || 'Not specified'}
- Severity: ${severity || 'Not specified'}
${medicalHistory?.length ? `- Medical History: ${medicalHistory.join(', ')}` : ''}
${currentMedications?.length ? `- Current Medications: ${currentMedications.join(', ')}` : ''}

Based on the above information, please provide:
1. A brief analysis of potential conditions (list out)
2. Any immediate recommendations
3. Level of urgency (if any)

Please be clear and empathetic in your response. [/INST]`;

              try {
                // Current MedLLaMA implementation
                const result = await queryMedicalDiagnosis(prompt);
                
                if (!Array.isArray(result) || result.length === 0) {
                  throw new Error('Invalid response format');
                }

                // Write internal tool response with raw result for the chatbot
                dataStream.writeData({
                  type: 'internal-tool-response',
                  content: {
                    rawResponse: result,
                    internalOnly: true
                  }
                });

                // Get the generated text
                const text = result[0].generated_text;

                // Write the response text in chunks to simulate streaming
                const chunkSize = 10;
                for (let i = 0; i < text.length; i += chunkSize) {
                  const chunk = text.slice(i, i + chunkSize);
                  dataStream.writeData({
                    type: 'text-delta',
                    content: chunk,
                    internalOnly: true  // This will be shown in UI
                  });
                  
                  // Add a small delay to make the streaming more natural
                  await new Promise(resolve => setTimeout(resolve, 10));
                }

                return {
                  analysis: text,
                  disclaimer: "This is a preliminary analysis and not a definitive diagnosis. Please consult with a healthcare professional for proper evaluation.",
                  internalOnly: true  // This will be shown in UI
                };
              } catch (error) {
                console.error('Error calling MedLLaMA model:', error);
                // Fallback to default model if MedLLaMA fails
                const { fullStream } = streamText({
                  model: customModel(model.apiIdentifier),
                  system: `You are a medical AI assistant. Based on the provided symptoms and patient information, 
                identify the most likely conditions and be empathetic and caring. Keep it jargon-free, preferring common terms and phrases and even analogies. Only provide medical-jargon details if the user asks for it. 
                Add a sentence - 'This is not a definitive diagnosis and please consult with a healthcare professional for proper evaluation' at the end.`,
                  prompt: JSON.stringify({
                    symptoms,
                    duration,
                    severity,
                    age,
                    gender,
                    medicalHistory,
                    currentMedications
                  }),
                });

                let analysis = '';
                for await (const delta of fullStream) {
                  if (delta.type === 'text-delta') {
                    analysis += delta.textDelta;
                    dataStream.writeData({
                      type: 'text-delta',
                      content: delta.textDelta,
                      internalOnly: true  // This will be shown in UI
                    });
                  }
                }

                return {
                  analysis,
                  disclaimer: "This is a preliminary analysis and not a definitive diagnosis. Please consult with a healthcare professional for proper evaluation.",
                  internalOnly: true  // This will be shown in UI
                };
              }
            },
          },
        },
        onFinish: async ({ response }) => {
          if (session.user?.id) {
            try {
              const responseMessagesWithoutIncompleteToolCalls =
                sanitizeResponseMessages(response.messages);

              // Filter out messages marked as internalOnly
              const uiMessages = responseMessagesWithoutIncompleteToolCalls.filter(
                message => !message.content?.internalOnly
              );

              await saveMessages({
                messages: uiMessages.map(
                  (message) => {
                    const messageId = generateUUID();

                    if (message.role === 'assistant') {
                      dataStream.writeMessageAnnotation({
                        messageIdFromServer: messageId,
                      });
                    }

                    return {
                      id: messageId,
                      chatId: id,
                      role: message.role,
                      content: message.content,
                      createdAt: new Date(),
                    };
                  },
                ),
              });
            } catch (error) {
              console.error('Failed to save chat');
            }
          }
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'stream-text',
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    await deleteChatById({ id });

    return new Response('Chat deleted', { status: 200 });
  } catch (error) {
    return new Response('An error occurred while processing your request', {
      status: 500,
    });
  }
}
