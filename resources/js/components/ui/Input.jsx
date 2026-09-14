function Input(props) {
    return (
        <input
            {...props}
            className="
                w-full
                rounded-lg
                border
                border-gray-300
                px-4
                py-3
                mt-1
                focus:outline-none
                focus:ring-2
                focus:ring-orange-400
                transition
            "
        />
    );
}
export default Input;
