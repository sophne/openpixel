/* The page, in document order (style.css and the UI test rely on it): the tab bar, the editor, the home screen, the New file
   page, the menus that open at a point, then the dialogs. Each piece is its area's component at a fixed path; the
   name and confirm dialogs are the kit's. App itself never renders again: every piece reads the stores it needs. */
import { useLayoutEffect, type ReactElement } from 'react';
import { ChatMenus } from './chat/ChatMenus';
import { Editor } from './editor/Editor';
import { Picker, ReviewDialog, ShortcutsDialog } from './editor/EditorDialogs';
import { Dialogs } from './kit';
import { useStore } from './lib/store';
import { AgentDialogs } from './library/Agents';
import { Home } from './library/Home';
import { LibraryMenus } from './library/LibraryMenus';
import { NewFileDialog, NewPage } from './library/NewPage';
import { TabBar } from './library/TabBar';
import { ui } from './state/ui';

/** <body data-view>: styles that depend on the page shown (the tab bar's right padding, hiding the editor under the
 *  home screen). It follows ui.view. */
function BodyView(): null {
  const { view } = useStore(ui);
  useLayoutEffect(() => { document.body.dataset.view = view; }, [view]);
  return null;
}

export function App(): ReactElement {
  return (
    <>
      <BodyView />
      <TabBar />
      <Editor />
      <Home />
      <NewPage />
      <LibraryMenus />
      <ChatMenus />
      <NewFileDialog />
      <Dialogs />
      <Picker />
      <AgentDialogs />
      <ShortcutsDialog />
      <ReviewDialog />
    </>
  );
}
