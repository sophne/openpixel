/* PLACEHOLDER (kit): the chat's two menus (index.html 310–312)
   The static markup of app/web/index.html, as JSX, with no behaviour. The chat port replaces this file: keep the
   path and the exported names (src/App.tsx imports them), and keep every tag, id, class and attribute. */
import type { ReactElement } from 'react';

/** The chats kept for the open file, and the agent + model picker (both open from the chat panel). */
export function ChatMenus(): ReactElement {
  return (
    <>
      <div className="menu-list dd-list card-menu chat-history-menu" id="chat-history-menu" role="menu"></div>
      <div className="menu-list dd-list card-menu chat-models" id="chat-model-menu" role="menu"></div>
    </>
  );
}
