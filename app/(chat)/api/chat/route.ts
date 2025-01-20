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
  | 'validatePatientFile';

const blocksTools: Array<AllowedTools> = [
  'createDocument',
  'updateDocument',
  'requestSuggestions',
  'validatePatientFile'
];

const weatherTools: Array<AllowedTools> = ['getWeather'];

const doctorTools: Array<AllowedTools> = ['getDoctorBySpeciality'];

const allTools: Array<AllowedTools> = [...blocksTools, ...weatherTools, ...doctorTools];

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
        experimental_activeTools: ['createDocument', 'updateDocument', 'requestSuggestions', 'getWeather', 'getDoctorBySpeciality', 'validatePatientFile'],
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
                  system: `Create a patient file with the following format:
# Patient File
- Patient Name: [Name if provided] \n
- Age: [Age if provided] \n
- City: [City if provided] \n
- Chief Complaints: [Main issues reported if provided] \n
- Symptoms: [List of symptoms with duration if provided] \n
- Current Medications: [If any provided] \n
- Other Notes: [Any other relevant information if provided] \n
- Recommended Speciality: [To be determined after analysis]`,
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

              return {
                message: `Found ${doctors.length} doctor(s) specializing in ${speciality}: ''}`,
                doctorData: doctorInfos
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
                message: 'Patient file validated and updated with references',
              };
            },
          },
        },
        onFinish: async ({ response }) => {
          if (session.user?.id) {
            try {
              const responseMessagesWithoutIncompleteToolCalls =
                sanitizeResponseMessages(response.messages);

              await saveMessages({
                messages: responseMessagesWithoutIncompleteToolCalls.map(
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
