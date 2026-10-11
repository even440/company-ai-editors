import '../src/shell/base.css';
import '../src/shell/shell.css';
import { mount } from '../src/shell/session';
import { MindEditor } from '../src/mind/MindEditor';

mount((s) => <MindEditor session={s} />);
