import '../src/shell/base.css';
import '../src/shell/shell.css';
import { BaseEditor } from '../src/base/BaseEditor';
import { mount } from '../src/shell/session';

mount((s) => <BaseEditor session={s} />);
