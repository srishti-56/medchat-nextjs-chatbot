import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { auth } from '@/app/(auth)/auth';
import { Chat } from '@/components/chat';
import { DEFAULT_MODEL_NAME, models } from '@/lib/ai/models';
import { getChatById, getMessagesByChatId, getUser } from '@/lib/db/queries';
import { convertToUIMessages } from '@/lib/utils';
import { DataStreamHandler } from '@/components/data-stream-handler';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;
  
  const session = await auth();

  if (!session?.user?.id) {
    notFound();
  }

  const chat = await getChatById({ id });

  if (!chat) {
    notFound();
  }

  if (chat.visibility === 'private') {
    if (!session || !session.user) {
      notFound();
    }

    if (session.user.id !== chat.userId) {
      notFound();
    }
  }

  const [messagesFromDb, users] = await Promise.all([
    getMessagesByChatId({ id }),
    getUser(session.user.email || '')
  ]);

  const user = users[0];
  const userInfo = user ? {
    name: user.name,
    age: user.age
  } : undefined;

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get('model-id')?.value;
  const selectedModelId = models.find((model) => model.id === modelIdFromCookie)?.id || DEFAULT_MODEL_NAME;

  return (
    <div className="flex-1 relative flex">
      <div className="flex-1 pr-96">
        <Chat
          id={chat.id}
          initialMessages={convertToUIMessages(messagesFromDb)}
          selectedModelId={selectedModelId}
          selectedVisibilityType={chat.visibility}
          isReadonly={session.user.id !== chat.userId}
          userId={session.user.id}
          userInfo={userInfo}
        />
        <DataStreamHandler id={id} />
      </div>
    </div>
  );
}
