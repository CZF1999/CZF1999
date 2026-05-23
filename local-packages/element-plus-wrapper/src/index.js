import MyButton from './button/Button.vue';
import MyInput from './input/Input.vue';
import MyTable from './table/Table.vue';
// export type { MergedProps as MyInputProps } from './input/MyInput';
// export type { MergedProps as MyTableProps } from './table/MyTable.vue';
export { MyButton, MyInput, MyTable };
const components = [MyButton, MyInput, MyTable];
const ElementPlusWrapper = {
    install(app) {
        components.forEach((comp) => {
            app.component(comp.name || '', comp);
        });
    },
};
export default ElementPlusWrapper;
