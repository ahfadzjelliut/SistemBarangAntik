import Input from "./input";

function SearchBar(value,onChange,placeholder) {
    return (
        <Input
            type="text"
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            className="
                w-28
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
export default SearchBar;
