import '../src/shell/base.css';
import '../src/shell/shell.css';
import '@univerjs/preset-sheets-core/lib/index.css';
import '../src/sheet/sheet.css';
import { mount } from '../src/shell/session';
import { SheetEditor } from '../src/sheet/SheetEditor';

mount((s) => <SheetEditor session={s} />);
