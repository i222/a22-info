import { Autocomplete, Chip, TextField } from '@mui/material'

interface TagQuickFilterProps {
	allTags: Array<string>
	value: Array<string>
	onChange: (tags: Array<string>) => void
	label?: string
	placeholder?: string
	size?: 'small' | 'medium'
}

export function TagQuickFilter({
	allTags,
	value,
	onChange,
	label = 'Quick filter by tags',
	placeholder = 'Select one or more tags',
	size = 'small',
}: TagQuickFilterProps) {
	return (
		<Autocomplete
			multiple
			options={allTags}
			value={value}
			onChange={(_, nextValue) => onChange(nextValue)}
			size={size}
			renderTags={(tagValue, getTagProps) =>
				tagValue.map((tag, index) => <Chip label={tag} {...getTagProps({ index })} key={tag} size="small" variant="outlined" color="primary" />)}
			renderInput={(params) => <TextField {...params} size={size} label={label} placeholder={placeholder} />}
		/>
	)
}
