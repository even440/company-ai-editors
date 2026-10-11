import '../src/shell/base.css';
import '../src/shell/shell.css';
import { mount } from '../src/shell/session';
import { FlowEditor } from '../src/flow/FlowEditor';

mount((s) => <FlowEditor session={s} />);
