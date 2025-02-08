import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { auth } from '@/app/(auth)/auth';
import { Chat } from '@/components/chat';
import { DEFAULT_MODEL_NAME, models } from '@/lib/ai/models';
import { getChatById, getMessagesByChatId, getUser } from '@/lib/db/queries';
import { convertToUIMessages } from '@/lib/utils';
import { DataStreamHandler } from '@/components/data-stream-handler';

export default async function Page({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  const [chat, messagesFromDb] = await Promise.all([
    getChatById({ id: params.id }),
    getMessagesByChatId({ id: params.id }),
  ]);

  if (!chat) {
    return null;
  }

  // Get user info
  const [user] = await getUser(session.user.email || '');
  const userInfo = user ? {
    name: user.name,
    age: user.age
  } : undefined;

  const selectedModelId = DEFAULT_MODEL_NAME;
  const selectedVisibilityType = chat.visibility;
  const isReadonly = chat.userId !== session.user.id;

  return (
    <div className="flex-1 relative flex">
      <div className="flex-1 pr-96">
        <Chat
          id={chat.id}
          initialMessages={convertToUIMessages(messagesFromDb)}
          selectedModelId={selectedModelId}
          selectedVisibilityType={selectedVisibilityType}
          isReadonly={isReadonly}
          userId={session.user.id}
          userInfo={userInfo}
        />
        <DataStreamHandler id={params.id} />
      </div>
    </div>
  );
}
