import { openai } from '@ai-sdk/openai';
import { mistral } from '@ai-sdk/mistral';
import { experimental_wrapLanguageModel as wrapLanguageModel } from 'ai';

import { customMiddleware } from './custom-middleware';

export const customModel = (apiIdentifier: string) => {
  if (apiIdentifier.includes('mistral') || apiIdentifier.includes('ministral')) {
    return wrapLanguageModel({
      model: mistral(apiIdentifier),
      middleware: customMiddleware,
    });
  }
  else{
    return wrapLanguageModel({
      model: openai(apiIdentifier),
      middleware: customMiddleware,
    });
  }
};
