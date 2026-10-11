import '../src/shell/base.css';
import '../src/shell/shell.css';
import { mount } from '../src/shell/session';
import { BoardEditor } from '../src/board/BoardEditor';

mount((s) => <BoardEditor session={s} />);
