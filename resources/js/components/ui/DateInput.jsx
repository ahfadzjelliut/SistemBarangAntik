import Input from "./input";

function DateInput(props) {
    return (
        <Input
            {...props}
            type="date"
            classname="
            w-full
            rounded-lg
            border
            border-gray-300
            bg-white
            px-4
            py-3
            text-gray-700
            shadow-sm
            outline-none
            transition
            focus:border-orange-400
            focus:ring-2
            focus:ring-orange-300
            "
        />
    );
}
export default DateInput;
