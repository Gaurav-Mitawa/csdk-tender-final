import { ChatWindow } from '@/components/chat/ChatWindow'

export const metadata = {
  title: 'Tender Agent | Chat',
}

export default function ChatPage() {
  return (
    <main className="h-[100dvh] w-full bg-background">
      <ChatWindow />
    </main>
  )
}
